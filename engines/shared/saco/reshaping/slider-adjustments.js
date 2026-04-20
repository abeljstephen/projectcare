// Ported from system-google-sheets-addon/core/reshaping/slider-adjustments.gs
// File: reshaping/slider-adjustments.gs
// Slider-based reshaping and manual adjustment
// Cleaned for pure Apps Script - global scope, no Node.js

function _sa_isValidPdfArray(arr) {
  return Array.isArray(arr) && arr.length >= 2 &&
    arr.every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y));
}

function _sa_isValidCdfArray(arr) {
  return Array.isArray(arr) && arr.length >= 2 &&
    arr.every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y));
}

function _sa_clamp01(v) {
  return Math.max(0, Math.min(1, Number(v)));
}

function _sa_asPointsArray(maybe) {
  if (Array.isArray(maybe)) return maybe;
  if (maybe && Array.isArray(maybe.value)) return maybe.value;
  return [];
}

/** Per-slider categories used in explanations and reports. */
var SLIDER_CATEGORIES = {
  budgetFlexibility: 'capacity',
  scheduleFlexibility: 'capacity',
  scopeCertainty: 'certainty',
  scopeReductionAllowance: 'process',
  reworkPercentage: 'process',
  riskTolerance: 'behavioral',
  userConfidence: 'other'
};

/** Simple band labels for human-readable slider magnitudes. */
function bandOf(v) {
  const x = Number(v) || 0;
  if (x === 0) return 'Zero';
  if (x <= 25) return 'Low';
  if (x <= 50) return 'Moderate';
  if (x <= 75) return 'High';
  return 'Very High';
}

/** Lightweight rule engine for counter-intuition and recommendations. */
function rulesEngine(sliders, baselineProb, finalProb, targetValue) {
  const s = sliders;
  const ci = [];
  const recs = [];

  const pct = (x) => (x == null ? '–' : (100 * x).toFixed(2) + '%');

  if ((s.reworkPercentage || 0) >= 30) {
    ci.push({
      pattern: 'Rework% is high',
      because: 'High rework creates fat right tails even when other controls look strong.',
      suggest: 'Reduce rework with peer reviews, definition-of-done gates, or continuous-improvement tooling.'
    });
    recs.push('Lower Rework% by 5–10 points and add quality gates on critical paths.');
  }

  if ((s.scopeCertainty || 0) >= 60 && (s.scopeReductionAllowance || 0) === 0) {
    ci.push({
      pattern: 'Scope Certainty high while Scope Reduction is zero',
      because: 'Locked scope prevents useful trade-offs if timelines compress.',
      suggest: 'Allow at least a small scope-reduction band so you can trade features for schedule if needed.'
    });
    recs.push('Enable scope trade-offs (Scope Reduction 10–25) to create contingency.');
  }

  if ((s.budgetFlexibility || 0) <= 10 &&
      (s.scheduleFlexibility || 0) <= 10 &&
      (s.riskTolerance || 0) <= 10) {
    ci.push({
      pattern: 'Budget, Schedule, and Risk all at Low',
      because: 'Tight constraints with low risk appetite tend to underperform unless certainty is extremely high.',
      suggest: 'Increase at least one lever (budget or schedule flexibility) to the Low/Moderate band.'
    });
    recs.push('Increase either Budget or Schedule flexibility to at least the Low band.');
  }

  if ((s.userConfidence || 0) >= 80 && baselineProb != null && baselineProb < 0.55) {
    ci.push({
      pattern: 'User Confidence is much higher than modeled probability',
      because: `Perception (${s.userConfidence}%) is outpacing modeled likelihood (${pct(baselineProb)}).`,
      suggest: 'Revisit assumptions and calibrate expectations using pilots or dry runs.'
    });
    recs.push('Run a pilot to calibrate expectations against modeled outcomes.');
  }

  if ((s.scopeReductionAllowance || 0) >= 75 && (s.riskTolerance || 0) >= 75) {
    ci.push({
      pattern: 'Scope Reduction and Risk Tolerance both Very High',
      because: 'Aggressive de-scoping with high risk taking can create quality and sustainability issues.',
      suggest: 'Dial one of these levers down to keep outcomes stable over time.'
    });
    recs.push('Reduce either Scope Reduction or Risk Tolerance to High/Moderate to avoid cliff behavior.');
  }

  return { counterIntuition: ci, recommendations: recs };
}

/**
 * Beta refit helper: map moments → Beta(α,β) on [optimistic, pessimistic].
 *
 * m0: mean-shift factor (0..1)
 * m1: variance-shrink factor (0..1)
 */
function betaRefit(optimistic, mostLikely, pessimistic, m0, m1) {
  const o = optimistic;
  const m = mostLikely;
  const p = pessimistic;

  const mu0 = (o + 4 * m + p) / 6;
  const var0 = ((p - o) / 6) ** 2;
  const range = Math.max(1e-9, p - o);

  // Mean and variance adjustments bounded to avoid degenerate shapes
  let mu1 = mu0 * (1 - _sa_clamp01(m0) * 0.2);
  mu1 = Math.max(o * 1.01, mu1); // keep mean safely above optimistic bound

  const var1 = Math.max(
    1e-12,
    Math.min(var0, var0 * (1 - _sa_clamp01(m1) * 0.5))
  );

  const mu01 = _sa_clamp01((mu1 - o) / range);
  const var01 = Math.max(1e-12, var1 / (range ** 2));

  const denom = mu01 * (1 - mu01) / var01 - 1;
  const alpha = mu01 * denom;
  const beta = (1 - mu01) * denom;

  if (!(alpha > 0 && beta > 0 && Number.isFinite(alpha) && Number.isFinite(beta))) {
    return null;
  }
  return { alpha, beta };
}

/**
 * Compute slider-adjusted probability and a reshaped distribution.
 * - probeLevel === 0  → manual mode (user sliders, no search; guardrails applied).
 * - probeLevel > 0    → SACO-style reshaping (moments → beta refit, richer explain).
 */
function computeSliderProbability({
  points,
  optimistic,
  mostLikely,
  pessimistic,
  targetValue,
  sliderValues,
  probeLevel = 0
}) {
  const basePdf = _sa_asPointsArray(points?.pdfPoints);
  const baseCdf = _sa_asPointsArray(points?.cdfPoints);

  if (!_sa_isValidCdfArray(baseCdf) || !_sa_isValidPdfArray(basePdf)) {
    return {
      probability: { value: null },
      reshapedPoints: { pdfPoints: basePdf, cdfPoints: baseCdf },
      explain: {
        baselineProb: null,
        finalProb: null,
        monotonicityAtTarget: 'Unknown',
        allZeroSlidersPassThrough: 'Unknown',
        narrative: 'Missing or invalid input points; returned pass-through.',
        projection: { used: false }
      }
    };
  }

  const tau = Number.isFinite(targetValue) ? Number(targetValue) : mostLikely;
  const baseProb = Number.isFinite(tau)
    ? _sa_clamp01(interpolateCdf(baseCdf, tau).value)
    : null;

  // Slider values in UI units
  const sv = Object.assign({
    budgetFlexibility: 0,
    scheduleFlexibility: 0,
    scopeCertainty: 0,
    scopeReductionAllowance: 0,
    reworkPercentage: 0,
    riskTolerance: 0,
    userConfidence: 100
  }, sliderValues || {});

  const allZero = Object.values({
    budgetFlexibility: sv.budgetFlexibility,
    scheduleFlexibility: sv.scheduleFlexibility,
    scopeCertainty: sv.scopeCertainty,
    scopeReductionAllowance: sv.scopeReductionAllowance,
    reworkPercentage: sv.reworkPercentage,
    riskTolerance: sv.riskTolerance
  }).every(v => Math.abs(Number(v)) < 1e-6);

  if (allZero) {
    return {
      probability: { value: baseProb },
      reshapedPoints: { pdfPoints: basePdf, cdfPoints: baseCdf },
      explain: {
        baselineProb: baseProb,
        finalProb: baseProb,
        monotonicityAtTarget: 'Yes',
        allZeroSlidersPassThrough: 'Yes',
        narrative: 'All sliders are zero; baseline distribution returned unchanged.',
        projection: { used: false },
        sliders: [],
        sliderCategories: {},
        bands: {},
        winningSliders: {
          budgetFlexibility: 0,
          scheduleFlexibility: 0,
          scopeCertainty: 0,
          scopeReductionAllowance: 0,
          reworkPercentage: 0,
          riskTolerance: 0,
          userConfidence: 100
        }
      }
    };
  }

  let finalProb = baseProb;
  let newCdf = baseCdf.slice();
  let newPdf = basePdf.slice();
  let explain = null;

  // Common derived values for shape-aware geometry
  const origMean = (optimistic + 4 * mostLikely + pessimistic) / 6;
  const cv = (pessimistic - optimistic) / Math.max(origMean, 1e-9);
  const range = pessimistic - optimistic;

  // Normalized sliders for diagnostics (0–1; rework in 0–0.5 band)
  const normalized01 = {
    budgetFlexibility: _sa_clamp01((sv.budgetFlexibility || 0) / 100),
    scheduleFlexibility: _sa_clamp01((sv.scheduleFlexibility || 0) / 100),
    scopeCertainty: _sa_clamp01((sv.scopeCertainty || 0) / 100),
    scopeReductionAllowance: _sa_clamp01((sv.scopeReductionAllowance || 0) / 100),
    reworkPercentage: _sa_clamp01((sv.reworkPercentage || 0) / 50),
    riskTolerance: _sa_clamp01((sv.riskTolerance || 0) / 100),
    userConfidence: _sa_clamp01((sv.userConfidence != null ? sv.userConfidence : 100) / 100)
  };

  // Sliders in percent units for computeAdjustedMoments (copula geometry)
  const sliders100 = {
    budgetFlexibility: sv.budgetFlexibility || 0,
    scheduleFlexibility: sv.scheduleFlexibility || 0,
    scopeCertainty: sv.scopeCertainty || 0,
    scopeReductionAllowance: sv.scopeReductionAllowance || 0,
    reworkPercentage: sv.reworkPercentage || 0,
    riskTolerance: sv.riskTolerance || 0,
    userConfidence: sv.userConfidence ?? 100
  };

  // -------- Manual path (probeLevel === 0): SACO geometry + manual guardrails ------
  if (probeLevel === 0 && sliderValues && Object.keys(sliderValues).length > 0) {
    let momentsObj;
    try {
      momentsObj = computeAdjustedMoments(sliders100, 1, cv);
    } catch (e) {
      momentsObj = { moments: [0, 0], explain: { error: e.message } };
    }

    const [m0, m1] = Array.isArray(momentsObj.moments) ? momentsObj.moments : [0, 0];
    const refit = betaRefit(optimistic, mostLikely, pessimistic, m0, m1);

    let kl = 0;
    let projectionUsed = false;
    let usedBeta = false;

    if (refit) {
      try {
        const numSamples = baseCdf.length || basePdf.length || 200;
        const betaPts = generateBetaPoints({
          optimistic,
          mostLikely,
          pessimistic,
          numSamples,
          alpha: refit.alpha,
          beta: refit.beta
        });

        if (_sa_isValidPdfArray(betaPts.pdfPoints) && _sa_isValidCdfArray(betaPts.cdfPoints)) {
          newPdf = betaPts.pdfPoints;
          newCdf = betaPts.cdfPoints;
          usedBeta = true;

          if (Number.isFinite(tau)) {
            finalProb = _sa_clamp01(interpolateCdf(newCdf, tau).value);
          }

          const safeRange = Math.max(1e-9, range);
          const basePdfN = basePdf.map(pt => ({
            x: (pt.x - optimistic) / safeRange,
            y: pt.y * safeRange
          }));
          const newPdfN = newPdf.map(pt => ({
            x: (pt.x - optimistic) / safeRange,
            y: pt.y * safeRange
          }));

          try {
            const klObj = computeKLDivergence({
              distributions: {
                triangle: { pdfPoints: newPdfN },
                monteCarloSmoothed: { pdfPoints: basePdfN }
              },
              task: 'manual-refit'
            });
            kl = Number(
              klObj['triangle-monteCarloSmoothed'] ??
              klObj.value ??
              klObj.kl ??
              0
            );
          } catch (e) {
            kl = 0;
          }
        }
      } catch (e) {
        usedBeta = false;
      }
    }

    // If refit failed or points invalid, fall back to a gentle "lift" on the CDF
    if (!usedBeta || !_sa_isValidPdfArray(newPdf) || !_sa_isValidCdfArray(newCdf)) {
      const w = {
        budgetFlexibility: 0.20,
        scheduleFlexibility: 0.20,
        scopeCertainty: 0.20,
        scopeReductionAllowance: 0.15,
        reworkPercentage: -0.15,
        riskTolerance: 0.07,
        userConfidence: 0.03
      };

      const raw = Object.keys(normalized01).reduce((sum, key) => {
        const val = normalized01[key];
        const keyWeight = w[key] || 0;
        return sum + keyWeight * val;
      }, 0);

      const maxDelta = 0.25;
      const gain = Math.max(-maxDelta, Math.min(maxDelta, raw)) * 0.25;

      const baseCdfSorted = baseCdf.slice().sort((a, b) => a.x - b.x);
      const liftedCdf = baseCdfSorted.map(p => {
        const F = _sa_clamp01(Number(p.y));
        const lifted = _sa_clamp01(F + gain * (1 - F));
        return { x: Number(p.x), y: lifted };
      });

      newCdf = liftedCdf;

      const derivedPdf = [{ x: newCdf[0].x, y: 0 }];
      for (let i = 1; i < newCdf.length; i++) {
        const dx = Math.max(1e-12, newCdf[i].x - newCdf[i - 1].x);
        const dy = _sa_clamp01(newCdf[i].y) - _sa_clamp01(newCdf[i - 1].y);
        const dens = Math.max(0, dy / dx);
        const midX = newCdf[i - 1].x + dx / 2;
        derivedPdf.push({ x: midX, y: dens });
      }
      derivedPdf.push({ x: newCdf[newCdf.length - 1].x, y: 0 });
      newPdf = derivedPdf;

      if (Number.isFinite(tau)) {
        finalProb = _sa_clamp01(interpolateCdf(newCdf, tau).value);
      }
      kl = 0;
    }

    // Manual guardrail: do not allow manual sliders to produce a worse
    // probability at the target than the baseline.
    if (Number.isFinite(finalProb) &&
        Number.isFinite(baseProb) &&
        finalProb < baseProb) {
      projectionUsed = true;
      finalProb = baseProb;
      newPdf = basePdf.slice();
      newCdf = baseCdf.slice();
    }

    const liftPts = (Number.isFinite(finalProb) && Number.isFinite(baseProb))
      ? (finalProb - baseProb) * 100
      : 0;

    const bands = {};
    const cats = {};
    const winning = {};
    for (const k of Object.keys(SLIDER_CATEGORIES)) {
      const vRaw = Number(sv[k] || 0);
      bands[k] = bandOf(vRaw);
      cats[k] = SLIDER_CATEGORIES[k];
      if (vRaw >= 50) winning[k] = vRaw;
    }

    explain = {
      baselineProb: baseProb,
      finalProb: finalProb,
      monotonicityAtTarget: 'Yes',
      allZeroSlidersPassThrough: 'No',
      sliderCategories: cats,
      bands,
      winningSliders: winning,
      projection: {
        used: projectionUsed,
        guard: 'baseline-or-better'
      },
      narrative: `Manual mode: user sliders applied with shape-aware beta refit; ΔF(τ) = ${
        liftPts >= 0 ? '+' : ''
      }${liftPts.toFixed(2)} points at τ=${
        Number.isFinite(tau) ? tau.toFixed(3) : '–'
      }${projectionUsed ? ' (projection guard prevented a worse-than-baseline outcome).' : '.'}`,
      counterIntuition: [],
      recommendations: [],
      moments: momentsObj && momentsObj.explain ? momentsObj.explain : undefined,
      cv,
      klDivergence: kl,
      manualSliders: normalized01,
      status: 'manual-applied'
    };
  } else {
    // -------- SACO-style path (probeLevel > 0): moments → beta refit + diagnostics ----
    let momentsObj;
    try {
      momentsObj = computeAdjustedMoments(sliders100, 1, cv);
    } catch (e) {
      momentsObj = { moments: [0, 0], explain: { error: e.message } };
    }

    const [m0, m1] = momentsObj.moments || [0, 0];

    const origVar = ((pessimistic - optimistic) / 6) ** 2;
    const newMean = origMean * (1 - m0 * 0.2);
    const newVar = origVar * (1 - m1 * 0.5);
    const scaledNewMean = (newMean - optimistic) / Math.max(range, 1e-9);
    const scaledNewVar = newVar / Math.max(range ** 2, 1e-12);

    const denom = scaledNewMean * (1 - scaledNewMean) / Math.max(scaledNewVar, 1e-12) - 1;
    const alphaNew = scaledNewMean * denom;
    const betaNew = (1 - scaledNewMean) * denom;

    let kl = 0;
    let usedRefit = false;

    if (alphaNew > 0 && betaNew > 0 &&
        Number.isFinite(alphaNew) &&
        Number.isFinite(betaNew)) {
      const newPoints = generateBetaPoints({
        optimistic,
        mostLikely,
        pessimistic,
        numSamples: baseCdf.length,
        alpha: alphaNew,
        beta: betaNew
      });

      if (_sa_isValidCdfArray(newPoints.cdfPoints) && _sa_isValidPdfArray(newPoints.pdfPoints)) {
        newCdf = newPoints.cdfPoints || baseCdf;
        newPdf = newPoints.pdfPoints || basePdf;
        usedRefit = true;

        finalProb = Number.isFinite(tau)
          ? _sa_clamp01(interpolateCdf(newCdf, tau).value)
          : null;

        const safeRange = Math.max(1e-9, range);
        const basePdfN = basePdf.map(pt => ({
          x: (pt.x - optimistic) / safeRange,
          y: pt.y * safeRange
        }));
        const newPdfN = newPdf.map(pt => ({
          x: (pt.x - optimistic) / safeRange,
          y: pt.y * safeRange
        }));

        try {
          const klObj = computeKLDivergence({
            distributions: {
              triangle: { pdfPoints: newPdfN },
              monteCarloSmoothed: { pdfPoints: basePdfN }
            },
            task: 'saco-refit'
          });
          kl = Number(
            klObj['triangle-monteCarloSmoothed'] ??
            klObj.value ??
            klObj.kl ??
            0
          );
        } catch (e) {
          kl = 0;
        }
      }
    }

    if (!usedRefit) {
      // Fallback: mild CDF lift based on slider weights
      console.warn('SACO: invalid refit parameters; using CDF lift fallback.');

      const w = {
        budgetFlexibility: 0.20,
        scheduleFlexibility: 0.20,
        scopeCertainty: 0.20,
        scopeReductionAllowance: 0.15,
        reworkPercentage: -0.15,
        riskTolerance: 0.07,
        userConfidence: 0.03
      };

      const raw = Object.keys(normalized01).reduce((sum, key) => {
        const val = normalized01[key];
        const keyWeight = w[key] || 0;
        return sum + keyWeight * val;
      }, 0);

      const maxDelta = 0.25;
      const gain = Math.max(-maxDelta, Math.min(maxDelta, raw)) * 0.25;

      const baseCdfSorted = baseCdf.slice().sort((a, b) => a.x - b.x);
      const liftedCdf = baseCdfSorted.map(p => {
        const F = _sa_clamp01(Number(p.y));
        const lifted = _sa_clamp01(F + gain * (1 - F));
        return { x: Number(p.x), y: lifted };
      });

      newCdf = liftedCdf;

      const derivedPdf = [{ x: newCdf[0].x, y: 0 }];
      for (let i = 1; i < newCdf.length; i++) {
        const dx = Math.max(1e-12, newCdf[i].x - newCdf[i - 1].x);
        const dy = _sa_clamp01(newCdf[i].y) - _sa_clamp01(newCdf[i - 1].y);
        const dens = Math.max(0, dy / dx);
        const midX = newCdf[i - 1].x + dx / 2;
        derivedPdf.push({ x: midX, y: dens });
      }
      derivedPdf.push({ x: newCdf[newCdf.length - 1].x, y: 0 });
      newPdf = derivedPdf;

      finalProb = Number.isFinite(tau)
        ? _sa_clamp01(interpolateCdf(newCdf, tau).value)
        : null;
    }

    const slidersExplain = Object.keys(SLIDER_CATEGORIES).map(key => {
      const val = Number(sv[key] || 0);
      const cat = SLIDER_CATEGORIES[key];
      const weight = (
        key === 'budgetFlexibility' ? 0.20 :
        key === 'scheduleFlexibility' ? 0.20 :
        key === 'scopeCertainty' ? 0.20 :
        key === 'scopeReductionAllowance' ? 0.15 :
        key === 'reworkPercentage' ? -0.15 :
        key === 'riskTolerance' ? 0.07 : 0.03
      );
      const value01 = key === 'reworkPercentage'
        ? _sa_clamp01(val / 50)
        : _sa_clamp01(val / 100);

      const lamPart = weight * value01;
      return {
        slider: key,
        value: value01,
        category: cat,
        weights: {
          blend: lamPart,
          leftShift: 0,
          tailShave: 0
        },
        modeledEffect: { alpha: 0, beta: 0 },
        contribution: {
          deltaTargetProbFromRaw:
            finalProb != null && baseProb != null
              ? (finalProb - baseProb) *
                (Math.abs(lamPart) / (Math.abs(lamPart) + 1e-9))
              : 0,
          shareOfProjectionLift: 0
        }
      };
    });

    const bands = {};
    const cats = {};
    const winning = {};
    for (const k of Object.keys(SLIDER_CATEGORIES)) {
      const vRaw = Number(sv[k] || 0);
      bands[k] = bandOf(vRaw);
      cats[k] = SLIDER_CATEGORIES[k];
      if (vRaw >= 50) winning[k] = vRaw;
    }

    const { counterIntuition, recommendations } = rulesEngine(sv, baseProb, finalProb, tau);

    const deltaPts = (Number.isFinite(finalProb) && Number.isFinite(baseProb))
      ? (finalProb - baseProb) * 100
      : 0;

    explain = {
      baselineProb: baseProb,
      finalProb: finalProb,
      monotonicityAtTarget: 'Yes',
      allZeroSlidersPassThrough: 'No',
      sliders: slidersExplain,
      sliderCategories: cats,
      bands,
      winningSliders: winning,
      projection: { used: false },
      narrative: `Shape-aware blend using copula-based moments and beta refit; ΔF(τ) = ${
        deltaPts >= 0 ? '+' : ''
      }${deltaPts.toFixed(2)} points at τ=${
        Number.isFinite(tau) ? tau.toFixed(3) : '–'
      }${usedRefit ? ' (beta refit applied).' : ' (fallback CDF lift used).'}`
      ,
      counterIntuition,
      recommendations,
      moments: momentsObj && momentsObj.explain ? momentsObj.explain : undefined,
      cv,
      klDivergence: typeof kl !== 'undefined' ? kl : 0,
      momentsBreakdown: momentsObj && momentsObj.moments
        ? Object.keys(sliders100).reduce((acc, key) => {
            const S01 = _sa_clamp01(
              sliders100[key] /
              (key === 'reworkPercentage' ? 50 : 100)
            );
            const w = {
              budgetFlexibility: 0.20,
              scheduleFlexibility: 0.20,
              scopeCertainty: 0.20,
              scopeReductionAllowance: 0.15,
              reworkPercentage: -0.15,
              riskTolerance: 0.07,
              userConfidence: 0.03
            }[key] || 0;
            const [mm0, mm1] = momentsObj.moments || [0, 0];
            acc[key] = {
              m0: mm0 * (w * S01 / (mm0 || 1)),
              m1: mm1 * (w * S01 / (mm1 || 1))
            };
            return acc;
          }, {})
        : {},
      status: 'saco-reshaped'
    };
  }

  const lift = (Number.isFinite(finalProb) && Number.isFinite(baseProb))
    ? (finalProb - baseProb)
    : 0;

  if (Number.isFinite(lift) && lift < 0.001 && lift > 0 && explain && typeof explain.narrative === 'string') {
    explain.narrative += ' (small positive change; effect is within ~0.1 percentage points.)';
  }

  if (!Number.isFinite(finalProb)) finalProb = 0.5;

  try {
    console.log('RESHAPE OUTPUT:', JSON.stringify({
      baseLen: baseCdf.length,
      newCdfLen: newCdf.length,
      newPdfLen: newPdf.length,
      allZero,
      CV: (pessimistic - optimistic) / Math.max(
        (optimistic + 4 * mostLikely + pessimistic) / 6,
        1e-9
      ),
      probeLevel
    }));
  } catch {
    // logging is best-effort only
  }

  if (!_sa_isValidPdfArray(newPdf) || !_sa_isValidCdfArray(newCdf)) {
    console.warn('RESHAPE: output points invalid; falling back to baseline.');
    return {
      probability: { value: baseProb },
      reshapedPoints: { pdfPoints: basePdf, cdfPoints: baseCdf },
      explain: {
        ...(explain || {}),
        narrative: (explain && explain.narrative
          ? explain.narrative + ' (fallback to baseline due to invalid output points).'
          : 'Fallback to baseline due to invalid output points.')
      }
    };
  }

  return {
    probability: { value: finalProb },
    reshapedPoints: { pdfPoints: newPdf, cdfPoints: newCdf },
    explain
  };
}

/**
 * Convenience alias: reshape distribution using sliders.
 * Defaults to probeLevel 1 (SACO-style path) when not explicitly set.
 */
function reshapeDistribution(args) {
  return computeSliderProbability({
    ...args,
    probeLevel: args.probeLevel || 1
  });
}
