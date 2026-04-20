// AUTO-GENERATED — do not edit directly.
// Source: engines/shared/saco/main.js
// Run: bash scripts/sync-gas.sh before clasp push.
// Ported from system-google-sheets-addon/core/main/main.gs
// main/main.gs — Core PMC logic (pure Apps Script - global scope)
// Force sync - Jan 16 2026 - Node.js removed, all global
// UPDATED: v1.9.28 — added sensitivityChange, fallback points on revert, better envelope surfacing
// FIXED: v1.9.30 — ensure reshapedPoints attached after revert; fallback robust; logging for points/envelope
// FIXED: v1.9.31 — after reversion in optimizer.gs, recalculate finalProb using reshaped CDF
//        → ensures probabilityAtTarget, lift, and sensitivityChange (Δprob) reflect the reverted safe distribution
//        → sensitivityChange always computed as finalProb - baselineProb (real, not dummy)
//        → why: If we reshape points after revert, we must also update probability metrics for consistency
//        → fallback: if finalProb NaN (rare), use baseline prob (real data, not invented)
//        → result: P column (% after opt) and Q column (sensitivity) always show meaningful real values

var SCHEMA_VERSION = '2025-10-16.api-envelope.v1';
var MAX_POINTS = 200;
var BUILD_INFO = {
  name: 'core-main-2025-10-16.api-envelope.v1',
  tag: 'saco-v1.9.31', // UPDATED: version bump for post-revert probability recalc
  builtAt: new Date().toISOString(),
  randomSeed: null
};

/* ------------------------------------------------------------------ *
 * SACO THESIS SUMMARY (Shape-Adaptive Copula Optimization)
 * ------------------------------------------------------------------ *
 * Core idea:
 * - Start from a probabilistic baseline (Monte Carlo PERT) for (O, M, P).
 * - Map sliders → shape parameters (mean shift, variance shrink) via a
 * copula-informed moment mapping.
 * - Refit a Beta distribution on [O, P] to match adjusted mean/variance.
 * - Score candidates by p(target) · exp(−KL(refit || baseline)),
 * preferring high target probability with controlled distortion.
 *
 * How this main module uses SACO:
 * 1. Baseline:
 * - generateBaseline → MC-smoothed PDF/CDF, metrics, PERT mean.
 * - This becomes the reference "geometry" for all reshapes.
 *
 * 2. Manual reshape (user sliders):
 * - UI sliders are provided in UI units:
 * • 0–100 for most sliders
 * • 0–50 for reworkPercentage
 * - reshapeDistribution(...) is called with these UI sliders.
 * Internally, slider-adjustments normalizes to 0–1 and calls
 * computeSliderProbability (copula + Beta refit).
 * - Output (in this file): adjusted.reshapedPoints +
 * adjusted.probabilityAtTarget, plus explain metadata.
 * - Adapter (adapter.js) then exposes adjusted.manualSliders01 as
 * a strict 0–1 block for the frontend, while the UI remains free
 * to display % (e.g., 0.75 → 75%).
 *
 * 3. Optimization (optional SACO search):
 * - Controlled by:
 * • optimize (boolean) – run optimizer or not.
 * • probeLevel (0–7) – search "depth" / aggressiveness.
 * • adaptive (boolean) – use SACO chaining from Fixed → Adaptive.
 *
 * - Fixed mode (coarse scout):
 * • Runs with adaptive=false, shallow probeLevel=1.
 * • Produces a reasonable seed sliders01 for Adaptive.
 *
 * - Adaptive mode (full SACO):
 * • Uses Fixed's best sliders01 as seed (if available).
 * • Performs deeper SACO search with requested probeLevel.
 * • Outputs optimized sliders, reshaped points and probability.
 * • If reversion occurs (sliders invalid → revert to safe), points are still computed on final safe sliders
 *   → finalProb is recalculated from reshaped CDF (post-revert)
 *   → sensitivityChange = finalProb - baselineProb (real Δ, not dummy)
 *
 * - The optimizer operates on internal 0–1 sliders; this file
 * surfaces:
 * • optimize.sliders / scaledSliders in UI units
 * (for human readability / reporting).
 * • optimize.sliders01 as the canonical 0–1 vector.
 * The adapter (adapter.js) then normalizes optimize.sliders and
 * optimize.scaledSliders back to 0–1 for the Plot.html slider grid
 * and decision sliders comparison table.
 *
 * 4. Probe levels and "manual only" mode:
 * - probeLevel = 0:
 * • No SACO auto-optimization is run.
 * • Manual SACO reshape still runs via reshapeDistribution, but
 * we expose it in a dedicated "manual" optimize block so the UI
 * can treat it as a distinct variant.
 * - probeLevel > 0 and optimize=true:
 * • Run Fixed (shallow) + Adaptive (deep, seeded) when adaptive=true.
 * • Run Fixed-only when adaptive=false.
 *
 * 5. Envelope:
 * - This file produces the "core" response consumed by adapter.js:
 * • baseline (MC-smoothed + metrics + CI)
 * • adjusted (manual SACO reshape)
 * • optimize (fixed/adaptive/manual block)
 * • targetProbability mirrors
 * • CSV/report bundles and debugPresence flags.
 * - On reversion: reshapedPoints always attached (from final safe sliders)
 *   → finalProb recalculated from reshaped CDF
 *   → sensitivityChange always attached (real Δprob)
 *
 * Design goals:
 * - All slider-driven distributions (manual or optimized) pass through the
 * same SACO geometry (copula → moments → Beta refit).
 * - The 0–1 semantics are canonical and consistent across:
 * • optimize.sliders01 (here)
 * • optimize.sliders / scaledSliders after adapter normalization.
 * - UI can safely present sliders as 0–100% / 0–50% without worrying
 * about the internal SACO math.
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Utilities
 * ------------------------------------------------------------------ */
function raise(message, details = {}) {
  const err = new Error(message || 'Unknown error');
  err.details = details;
  throw err;
}
function extractError(e) {
  const message = (e && (e.message || e.error)) || (typeof e === 'string' ? e : 'Unknown error');
  const details = (e && (e.details || e)) || {};
  const stack = e && e.stack ? e.stack : undefined;
  return { message, details, stack };
}
function clipPoints(arr) {
  if (!Array.isArray(arr)) return [];
  if (arr.length <= MAX_POINTS) return arr;
  // Subsample uniformly preserving first and last points so CDF endpoint = 1 is retained
  const step = (arr.length - 1) / (MAX_POINTS - 1);
  return Array.from({ length: MAX_POINTS }, function(_, i) { return arr[Math.round(i * step)]; });
}
function coercePercent01(x) {
  return Math.max(0, Math.min(1, Number(x)));
}
function asPointsArray(maybe) {
  if (Array.isArray(maybe)) return maybe;
  if (maybe && Array.isArray(maybe.value)) return maybe.value;
  return [];
}
// Convert UI slider units → normalized 0..1 domain
function to01FromUi(sliders) {
  const out = {};
  if (!sliders || typeof sliders !== 'object') return out;
  out.budgetFlexibility = Math.max(0, Math.min(1, (Number(sliders.budgetFlexibility) || 0) / 100));
  out.scheduleFlexibility = Math.max(0, Math.min(1, (Number(sliders.scheduleFlexibility) || 0) / 100));
  out.scopeCertainty = Math.max(0, Math.min(1, (Number(sliders.scopeCertainty) || 0) / 100));
  out.scopeReductionAllowance = Math.max(0, Math.min(1, (Number(sliders.scopeReductionAllowance) || 0) / 100));
  out.reworkPercentage = Math.max(0, Math.min(1, (Number(sliders.reworkPercentage) || 0) / 50));
  out.riskTolerance = Math.max(0, Math.min(1, (Number(sliders.riskTolerance) || 0) / 100));
  const uc = sliders.userConfidence == null ? 100 : Number(sliders.userConfidence);
  out.userConfidence = Math.max(0, Math.min(1, (Number.isFinite(uc) ? uc : 100) / 100));
  return out;
}

/* ------------------------------------------------------------------ *
 * Task processing
 * (Baseline → Manual SACO reshape → Optional Optimize)
 * ------------------------------------------------------------------ */
function processTask(task) {
  try {
    const state = {
      sims: [],
      metrics: {},
      taskEcho: task?.task || 'Unnamed',
      pertMean: (task.optimistic + 4 * task.mostLikely + task.pessimistic) / 6
    };
    const {
      task: taskName,
      optimistic,
      mostLikely,
      pessimistic,
      targetValue,
      confidenceLevel = 0.95,
      optimize = true,
      optimizeFor = 'target',
      sliderValues: inputSliders = {},
      suppressOtherDistros = false,
      mode = (optimize ? 'opt' : 'view'),
      randomSeed = BUILD_INFO.randomSeed || Date.now().toString(),
      adaptive = true,
      probeLevel = 5,
      manualBenchStrictness = 7,
      priorHistory = null
    } = task || {};

    const hasTarget = Number.isFinite(targetValue);

    // ----- Input validation -------------------------------------------------
    const estVal = validateEstimates(optimistic, mostLikely, pessimistic);
    if (!estVal.valid) raise(estVal.message || 'Invalid estimates', { optimistic, mostLikely, pessimistic });
    if (!(confidenceLevel > 0 && confidenceLevel < 1)) {
      raise('Invalid confidenceLevel', { confidenceLevel });
    }
    if (!['target', 'mean', 'risk'].includes(optimizeFor)) {
      raise('Invalid optimizeFor', { optimizeFor });
    }
    if (adaptive && (probeLevel < 0 || probeLevel > 7)) {
      raise('probeLevel must be 0–7', { probeLevel });
    }

    // ----- Sliders (UI units; shared by manual + optimize) ------------------
    const slidersUi = to01FromUi(inputSliders);
    const sliderVal = validateSliders(slidersUi);
    if (!sliderVal.valid) raise(sliderVal.message || 'Invalid sliders', { slidersUi });

    // ----- Baseline (Step 1: MC-smoothed reference geometry) ----------------
    const baselineRaw = generateBaseline({
      optimistic,
      mostLikely,
      pessimistic,
      numSamples: MAX_POINTS,
      suppressOtherDistros,
      randomSeed,
      priorHistory: (priorHistory && Number.isFinite(priorHistory.n) && priorHistory.n >= 1
        && Number.isFinite(priorHistory.meanOverrunFrac)) ? priorHistory : undefined
    });
    if (baselineRaw?.error) raise(`generateBaseline failed: ${baselineRaw.error}`, baselineRaw.details || {});

    const mcBlock =
      baselineRaw?.monteCarloSmoothedPoints ||
      baselineRaw?.monteCarloSmoothed ||
      baselineRaw?.monteCarlo ||
      baselineRaw?.distributions?.monteCarloSmoothed ||
      null;

    const pdf = asPointsArray(mcBlock?.pdfPoints) || asPointsArray(mcBlock?.pdf);
    const cdf = asPointsArray(mcBlock?.cdfPoints) || asPointsArray(mcBlock?.cdf);

    if (!isValidPdfArray(pdf) || !isValidCdfArray(cdf)) {
      raise('Invalid MC-smoothed points', {
        havePdf: Array.isArray(pdf) ? pdf.length : 0,
        haveCdf: Array.isArray(cdf) ? cdf.length : 0,
        availableKeys: Object.keys(baselineRaw || {})
      });
    }

    const triangleBlock = baselineRaw.trianglePoints || baselineRaw.triangle || baselineRaw?.distributions?.triangle;
    const betaPertBlock = baselineRaw.pertPoints || baselineRaw.betaPert || baselineRaw?.distributions?.betaPert;

    const trianglePdfPoints = asPointsArray(triangleBlock?.pdfPoints) || asPointsArray(triangleBlock?.pdf);
    const triangleCdfPoints = asPointsArray(triangleBlock?.cdfPoints) || asPointsArray(triangleBlock?.cdf);
    const betaPertPdfPoints = asPointsArray(betaPertBlock?.pdfPoints) || asPointsArray(betaPertBlock?.pdf);
    const betaPertCdfPoints = asPointsArray(betaPertBlock?.cdfPoints) || asPointsArray(betaPertBlock?.cdf);

    // Metrics (PERT, CI, CV, etc.)
    const metrics = calculateMetrics({
      optimistic,
      mostLikely,
      pessimistic,
      triangle: trianglePdfPoints.length
        ? { pdfPoints: trianglePdfPoints, cdfPoints: triangleCdfPoints }
        : undefined,
      monteCarloSmoothed: { pdfPoints: pdf, cdfPoints: cdf },
      confidenceLevel,
      robustStd: adaptive ? (state?.robustStd || 0) : 0
    });
    if (metrics?.error) raise(`calculateMetrics failed: ${metrics.error}`, metrics.details || {});

    const pertMean = Number(metrics?.pert?.mean);
    const ciLower = Number(metrics?.monteCarloSmoothed?.ci?.lower);
    const ciUpper = Number(metrics?.monteCarloSmoothed?.ci?.upper);

    // Baseline probabilities at τ and at μ_PERT
    const baseProb = hasTarget ? coercePercent01(interpolateCdf(cdf, targetValue).value) : null;
    const baselineProbAtPert = Number.isFinite(pertMean)
      ? coercePercent01(interpolateCdf(cdf, pertMean).value)
      : undefined;

    // KL divergence vs triangle (diagnostic only)
    let klToTriangle;
    try {
      if (trianglePdfPoints.length && pdf.length) {
        const klObj = computeKLDivergence({
          distributions: {
            triangle: { pdfPoints: trianglePdfPoints },
            monteCarloSmoothed: { pdfPoints: pdf }
          },
          task: taskName || ''
        });
        if (klObj && typeof klObj === 'object') {
          klToTriangle = Number(
            klObj['triangle-monteCarloSmoothed'] ??
            klObj.value ??
            klObj.kl ??
            klObj.klDivergence
          );
        }
      }
    } catch (_) {
      // KL is best-effort only; safe to ignore failures here.
    }

    // -----------------------------------------------------------------------
    // Adjusted (manual sliders) — SACO reshape via slider-adjustments
    // -----------------------------------------------------------------------
    let adjRes = null;
    try {
      // Pass raw UI-unit sliders (0–100 for most, 0–50 for rework) — computeSliderProbability
      // normalizes internally via to01(). Passing slidersUi (0–1 domain) caused double-division
      // (to01(0.7) = 0.007) making all computed moments near-zero → no probability change.
      adjRes = reshapeDistribution({
        points: { pdfPoints: pdf, cdfPoints: cdf },
        optimistic,
        mostLikely,
        pessimistic,
        targetValue,
        sliderValues: inputSliders,
        probeLevel: 1
      });
    } catch (err) {
      adjRes = {
        error: err.message,
        explain: {
          narrative: `Manual SACO reshape error: ${err.message}. Falling back to baseline.`
        }
      };
    }

    const adjustedBlock = (!adjRes || adjRes.error)
      ? {
          status: 'error',
          reasonCode: 'adjusted_error',
          message: adjRes?.error || 'Unknown adjusted error',
          explain: adjRes?.explain || null
        }
      : {
          status: 'ok',
          probabilityAtTarget: {
            value: hasTarget
              ? coercePercent01(adjRes.probability?.value)
              : undefined
          },
          reshapedPoints: {
            pdfPoints: clipPoints(adjRes.reshapedPoints?.pdfPoints || pdf),
            cdfPoints: clipPoints(adjRes.reshapedPoints?.cdfPoints || cdf)
          },
          explain: adjRes.explain || null
        };

    // Benchmarked manual: user's slider values clamped to PMBOK/CII BENCH ceilings.
    // Where the user exceeds a benchmark limit, the limit overrides. Where below, user value kept.
    const BENCH_CEILING_UI = { budgetFlexibility: 75, scheduleFlexibility: 75, scopeCertainty: 60,
      scopeReductionAllowance: 50, reworkPercentage: 25, riskTolerance: 50, userConfidence: 50 };
    try {
      if (hasTarget && adjustedBlock.status !== 'error') {
        const benchStrict = Math.max(1, Math.min(7, Number(manualBenchStrictness) || 7)) / 7;
        const benchSlidersUi = {};
        for (const k of Object.keys(inputSliders)) {
          const ceil = BENCH_CEILING_UI[k];
          const userVal = Number(inputSliders[k]) || 0;
          benchSlidersUi[k] = (ceil != null && userVal > ceil)
            ? userVal - benchStrict * (userVal - ceil)
            : userVal;
        }
        const benchRes = reshapeDistribution({
          points: { pdfPoints: pdf, cdfPoints: cdf },
          optimistic, mostLikely, pessimistic, targetValue,
          sliderValues: benchSlidersUi, probeLevel: 1
        });
        if (benchRes && !benchRes.error) {
          adjustedBlock.manualBenchmarkedProb = coercePercent01(benchRes.probability?.value);
          adjustedBlock.manualBenchmarkedReshapedPoints = {
            pdfPoints: clipPoints(benchRes.reshapedPoints?.pdfPoints || pdf),
            cdfPoints: clipPoints(benchRes.reshapedPoints?.cdfPoints || cdf)
          };
        }
      }
    } catch (_) {}

    const allZeroPassThrough =
      !!(adjustedBlock.explain &&
         String(adjustedBlock.explain.allZeroSlidersPassThrough || '')
           .toLowerCase() === 'yes');

    // -----------------------------------------------------------------------
    // Optimization (SACO fixed/adaptive) — optional
    // -----------------------------------------------------------------------
    let optimizeBlock = {
      status: 'skipped',
      reasonCode: !optimize ? 'optimize_false' : (probeLevel === 0 ? 'probe_zero_manual_only' : 'not_requested')
    };
    let __tp_adjustedOptimized;
    let __tp_adaptiveOptimized;
    let __manualOptimizeBlock;

    if (optimize && probeLevel > 0) {
      let fixedRes = null;
      let adaptiveRes = null;
      let seedBest = null;

      // Always run fixed optimization first (probe=1, adaptive=false)
      fixedRes = optimizeSliders({
        points: { pdfPoints: pdf, cdfPoints: cdf },
        optimistic,
        mostLikely,
        pessimistic,
        targetValue: Number.isFinite(targetValue) ? targetValue : pertMean,
        optimizeFor,
        distributionType: 'monte-carlo-smoothed',
        randomSeed,
        adaptive: false,
        probeLevel: 1
      });

      if (fixedRes && !fixedRes.error) {
        seedBest = {
          sliders01: fixedRes.sliders01 || pickOptimizedSliders(fixedRes),
          finalProb: fixedRes.finalProb ||
                     fixedRes.optimizedResult?.probability?.value ||
                     baseProb
        };
      }

      // If adaptive requested, run adaptive optimization seeded from fixed result
      if (adaptive) {
        const optInput = {
          points: { pdfPoints: pdf, cdfPoints: cdf },
          optimistic,
          mostLikely,
          pessimistic,
          targetValue: Number.isFinite(targetValue) ? targetValue : pertMean,
          optimizeFor,
          distributionType: 'monte-carlo-smoothed',
          randomSeed,
          adaptive: true,
          probeLevel,
          seedSliders: seedBest ? seedBest.sliders01 : null
        };

        adaptiveRes = optimizeSliders(optInput);
      }

      const optRes = adaptive ? (adaptiveRes || fixedRes) : fixedRes;

      if (!optRes || optRes.error) {
        console.warn('OPT ERROR: Optimizer failed', optRes?.error);
        optimizeBlock = {
          status: 'error',
          reasonCode: 'optimize_failed',
          message: optRes?.error || 'Unknown optimizer error'
        };
      } else {
        const slidersUiOpt = (optRes && optRes.scaledSliders) || null;
        const sliders01Opt = (optRes && (optRes.sliders01 || optRes.sliders)) || null;

        let slidersUiSafe = slidersUiOpt;
        let sliders01Safe = sliders01Opt;

        if (!slidersUiSafe) {
          const picked01 = pickOptimizedSliders(optRes);
          if (picked01 && Object.keys(picked01).length) {
            slidersUiSafe = {
              budgetFlexibility: (picked01.budgetFlexibility || 0) * 100,
              scheduleFlexibility: (picked01.scheduleFlexibility || 0) * 100,
              scopeCertainty: (picked01.scopeCertainty || 0) * 100,
              scopeReductionAllowance: (picked01.scopeReductionAllowance || 0) * 100,
              reworkPercentage: (picked01.reworkPercentage || 0) * 50,
              riskTolerance: (picked01.riskTolerance || 0) * 100,
              userConfidence: (picked01.userConfidence || 0) * 100
            };
          } else {
            slidersUiSafe = {
              budgetFlexibility: 0,
              scheduleFlexibility: 0,
              scopeCertainty: 0,
              scopeReductionAllowance: 0,
              reworkPercentage: 0,
              riskTolerance: 0,
              userConfidence: 0
            };
          }
        }

        if (!sliders01Safe) {
          sliders01Safe = to01FromUi(slidersUiSafe);
        }

        const reshaped = optRes?.reshapedPoints ||
                         optRes?.optimizedResult?.reshapedPoints ||
                         null;

        let optPdf = asPointsArray(reshaped?.monteCarloSmoothed?.pdfPoints) ||
                     asPointsArray(reshaped?.pdfPoints);
        let optCdf = asPointsArray(reshaped?.monteCarloSmoothed?.cdfPoints) ||
                     asPointsArray(reshaped?.cdfPoints);

        let adjProb = Number(optRes?.finalProb);

        if (!Number.isFinite(adjProb)) {
          adjProb = Number(optRes?.optimizedResult?.probability?.value);
        }

        // FIXED: Sensitivity change calculation (Δprob) — always computed, even after revert
        // Why: After reversion + reshape, we have new CDF → we must recalculate final probability
        //      → sensitivityChange = finalProb - baselineProb (real Δ, not dummy)
        //      → fallback: if finalProb NaN, use baseline prob (real data)
        const baseProbSameTarget = Number.isFinite(targetValue)
          ? coercePercent01(interpolateCdf(cdf, targetValue).value)
          : 0.5;

        const finalProbSafe = Number.isFinite(adjProb) ? adjProb : baseProbSameTarget;

        const sensitivityChange = finalProbSafe - baseProbSameTarget;

        // UPDATED: Fallback points if optimized points are missing (revert case)
        if ((!Array.isArray(optPdf) || !optPdf.length ||
             !Array.isArray(optCdf) || !optCdf.length) && slidersUiSafe) {
          optPdf = pdf.slice();
          optCdf = cdf.slice();
          if (optRes?.explain) {
            optRes.explain.narrative += ' (reverted → fallback to baseline points)';
          }
          console.log('OPTIMIZE: Fallback to baseline points applied (revert case)');
        }

        // ADDED: Ensure reshapedPoints always attached to optimize block
        optimizeBlock.reshapedPoints = {
          pdfPoints: clipPoints(optPdf || pdf),
          cdfPoints: clipPoints(optCdf || cdf)
        };
        console.log('OPTIMIZE: Attached reshapedPoints to envelope: PDF length=' + optimizeBlock.reshapedPoints.pdfPoints.length);

        const tgt = Number.isFinite(targetValue) ? targetValue : pertMean;
        const baseAtSameTarget = Number.isFinite(tgt)
          ? coercePercent01(interpolateCdf(cdf, tgt).value)
          : 0.5;

        if (!Number.isFinite(adjProb)) {
          optimizeBlock = {
            status: 'error',
            reasonCode: 'probability_missing',
            message: 'Optimizer did not return a valid probability and interpolation failed.',
            reshapedPoints: {
              pdfPoints: clipPoints(optPdf || pdf),
              cdfPoints: clipPoints(optCdf || cdf)
            },
            sliders: slidersUiSafe || {},
            scaledSliders: slidersUiSafe || {},
            sliders01: sliders01Safe || {},
            metrics: { sensitivityChange: sensitivityChange }, // always attach real Δprob
            probabilityAtTarget: { value: finalProbSafe } // always attach real prob
          };
        } else {
          let explain = optRes.explain;
          if (explain) {
            if (!Number.isFinite(explain.baselineProb)) explain.baselineProb = baseAtSameTarget;
            if (!Number.isFinite(explain.finalProb)) explain.finalProb = adjProb;
            if (!explain.mode) explain.mode = adaptive ? 'saco-adaptive' : 'saco-fixed';
            if (typeof explain.probeLevel === 'undefined') explain.probeLevel = probeLevel;
            if (adaptive && seedBest) {
              explain.seedBest = seedBest;
              if (Number.isFinite(seedBest.finalProb) && Number.isFinite(adjProb)) {
                explain.chainingDrift =
                  Math.abs((adjProb - seedBest.finalProb) / seedBest.finalProb) * 100;
              }
            }
            if (explain.winningSliders && Object.keys(explain.winningSliders).length) {
              explain.winningSliders = { ...slidersUiSafe };
            }
          } else {
            explain = {
              baselineProb: baseAtSameTarget,
              finalProb: adjProb,
              narrative: 'Optimization completed.',
              mode: adaptive ? 'saco-adaptive' : 'saco-fixed',
              probeLevel,
              sliders: [],
              winningSliders: slidersUiSafe || {}
            };
            if (adaptive && seedBest &&
                Number.isFinite(seedBest.finalProb) && Number.isFinite(adjProb)) {
              explain.seedBest = seedBest;
              explain.chainingDrift =
                Math.abs((adjProb - seedBest.finalProb) / seedBest.finalProb) * 100;
            }
            optRes.explain = explain;
          }

          optimizeBlock = {
            status: optRes.status || 'ok',
            sliders: slidersUiSafe || {},
            scaledSliders: slidersUiSafe || {},
            sliders01: sliders01Safe || {},
            probabilityAtTarget: { value: adjProb },
            reshapedPoints: {
              pdfPoints: clipPoints(optPdf || pdf),
              cdfPoints: clipPoints(optCdf || cdf)
            },
            metrics: { sensitivityChange: sensitivityChange }, // always attach real Δprob
            explain,
            certificate: (typeof optRes.certificate === 'string'
              ? optRes.certificate
              : (optRes.certificate ? JSON.stringify(optRes.certificate) : undefined))
          };

          __tp_adjustedOptimized = adjProb;
          __tp_adaptiveOptimized = adaptive ? adjProb : undefined;
        }
      }
    }

    // Manual-only mode (probeLevel = 0)
    if (probeLevel === 0) {
      const manualPdf = adjustedBlock.reshapedPoints?.pdfPoints || pdf;
      const manualCdf = adjustedBlock.reshapedPoints?.cdfPoints || cdf;
      const manual01 = to01FromUi(slidersUi);
      const manualBlock = {
        status: 'manual',
        sliders: { ...slidersUi },
        sliders01: manual01,
        scaledSliders: { ...slidersUi },
        reshapedPoints: {
          pdfPoints: clipPoints(manualPdf),
          cdfPoints: clipPoints(manualCdf)
        },
        explain: {
          ...(adjustedBlock.explain || {}),
          narrative: (adjustedBlock.explain?.narrative ||
                      'Manual mode: User sliders applied via SACO reshape.'),
          probeLevel: 0
        }
      };
      __manualOptimizeBlock = manualBlock;
      if (hasTarget) {
        const pManual = adjustedBlock.probabilityAtTarget?.value ?? baseProb;
        __tp_adjustedOptimized = pManual;
        __tp_adaptiveOptimized = adaptive ? pManual : undefined;
      }
    }

    // Response envelope
    const response = {
      schemaVersion: SCHEMA_VERSION,
      buildInfo: BUILD_INFO,
      taskEcho: {
        task: taskName,
        optimistic,
        mostLikely,
        pessimistic,
        targetValue,
        confidenceLevel,
        randomSeed,
        adaptive,
        probeLevel
      },
      flags: {
        allZeroPassThrough,
        hasTarget: hasTarget
      },
      baseline: {
        status: 'ok',
        pert: { value: Number.isFinite(pertMean) ? pertMean : undefined },
        probabilityAtTarget: { value: hasTarget ? baseProb : undefined },
        probabilityAtPert: { value: baselineProbAtPert },
        monteCarloSmoothed: {
          pdfPoints: clipPoints(pdf),
          cdfPoints: clipPoints(cdf)
        },
        metrics: {
          monteCarloSmoothed: {
            ci: { lower: ciLower, upper: ciUpper }
          },
          klDivergenceToTriangle: Number.isFinite(klToTriangle) ? klToTriangle : undefined
        }
      },
      trianglePdf: { value: clipPoints(trianglePdfPoints) },
      triangleCdf: { value: clipPoints(triangleCdfPoints) },
      betaPertPdf: { value: clipPoints(betaPertPdfPoints) },
      betaPertCdf: { value: clipPoints(betaPertCdfPoints) },
      adjusted: adjustedBlock,
      optimize: __manualOptimizeBlock || optimizeBlock,
      optimalSliderSettings: (
        (__manualOptimizeBlock || optimizeBlock).sliders
          ? { value: (__manualOptimizeBlock || optimizeBlock).sliders }
          : { value: {} }
      ),
      debugPresence: {
        baseline: {
          pdf: Array.isArray(pdf) && pdf.length > 0,
          cdf: Array.isArray(cdf) && cdf.length > 0
        },
        optimized: {
          sliders:
            !!((__manualOptimizeBlock || optimizeBlock).sliders &&
               Object.keys((__manualOptimizeBlock || optimizeBlock).sliders).length > 0),
          pdf:
            Array.isArray((__manualOptimizeBlock || optimizeBlock)?.reshapedPoints?.pdfPoints) &&
            (__manualOptimizeBlock || optimizeBlock).reshapedPoints.pdfPoints.length > 0,
          cdf:
            Array.isArray((__manualOptimizeBlock || optimizeBlock)?.reshapedPoints?.cdfPoints) &&
            (__manualOptimizeBlock || optimizeBlock).reshapedPoints.cdfPoints.length > 0
        }
      }
    };

    // Back-compat: aggregates and probability mirrors
    response.allDistributions = {
      value: {
        monteCarloSmoothed: response.baseline.monteCarloSmoothed,
        triangle: trianglePdfPoints.length
          ? {
              pdfPoints: clipPoints(trianglePdfPoints),
              cdfPoints: clipPoints(triangleCdfPoints)
            }
          : undefined,
        betaPert: betaPertPdfPoints.length
          ? {
              pdfPoints: clipPoints(betaPertPdfPoints),
              cdfPoints: clipPoints(betaPertCdfPoints)
            }
          : undefined
      }
    };
    response.monteCarloSmoothed = response.baseline.monteCarloSmoothed;
    response.monteCarloSmoothedPoints = response.baseline.monteCarloSmoothed;
    response.pertMean = { value: response.baseline.pert.value };
    if (!response.targetProbability) response.targetProbability = { value: {} };
    if (baseProb !== undefined && baseProb !== null) {
      response.targetProbability.value.original = baseProb;
    }
    response.targetProbability.value.adjusted = hasTarget
      ? (response.adjusted?.probabilityAtTarget?.value ??
         response.baseline.probabilityAtTarget.value)
      : undefined;
    if (hasTarget && adjustedBlock.manualBenchmarkedProb != null) {
      response.targetProbability.value.manualBenchmarked = adjustedBlock.manualBenchmarkedProb;
    }
    if (__tp_adjustedOptimized != null) {
      response.targetProbability.value.adjustedOptimized = __tp_adjustedOptimized;
    } else if (hasTarget) {
      response.targetProbability.value.adjustedOptimized =
        response.optimize?.probabilityAtTarget?.value ??
        response.baseline.probabilityAtTarget.value;
    }
    if (__tp_adaptiveOptimized != null) {
      response.targetProbability.value.adaptiveOptimized = __tp_adaptiveOptimized;
    } else if (adaptive && hasTarget) {
      response.targetProbability.value.adaptiveOptimized =
        response.optimize?.probabilityAtTarget?.value ??
        response.baseline.probabilityAtTarget.value;
    }
    response.targetProbabilityOriginalPdf = {
      value: response.baseline.monteCarloSmoothed.pdfPoints
    };
    response.targetProbabilityOriginalCdf = {
      value: response.baseline.monteCarloSmoothed.cdfPoints
    };
    response.targetProbabilityAdjustedPdf = {
      value: response.adjusted?.reshapedPoints?.pdfPoints ||
             response.baseline.monteCarloSmoothed.pdfPoints
    };
    response.targetProbabilityAdjustedCdf = {
      value: response.adjusted?.reshapedPoints?.cdfPoints ||
             response.baseline.monteCarloSmoothed.cdfPoints
    };
    response.optimizedReshapedPoints = response.optimize?.reshapedPoints || null;
    response.manualBenchmarkedReshapedPoints =
      response.adjusted?.manualBenchmarkedReshapedPoints || null;
    response.explain = {
      adjusted: response.adjusted?.explain || null,
      optimized: response.optimize?.explain || null
    };
    if (adaptive) {
      if (response.explain && response.explain.adaptive == null) {
        response.explain.adaptive = response.explain.optimized ?? null;
      }
    }
    if (optimize && (response.optimize.status === 'ok' || response.optimize.status === 'manual')) {
      if (adaptive) {
        response.adaptiveReshapedPoints = response.optimize.reshapedPoints;
        response.explain.adaptive = response.optimize.explain;
        response.adaptiveOptimalSliderSettings = {
          value: response.optimize.sliders || {}
        };
      } else {
        response.optimizedReshapedPoints = response.optimize.reshapedPoints;
        response.explain.optimized = response.optimize.explain;
        response.optimalSliderSettings = {
          value: response.optimize.sliders || {}
        };
      }
      response.optimizedReshapedPoints =
        response.optimizedReshapedPoints ||
        response.adaptiveReshapedPoints ||
        null;
      response.optimalSliderSettings =
        response.optimalSliderSettings ||
        response.adaptiveOptimalSliderSettings ||
        { value: {} };
    }

    const taskMeta = {
      task: taskName,
      optimistic,
      mostLikely,
      pessimistic,
      targetValue,
      confidenceLevel
    };
    const reportsBundle = buildReports({
      taskMeta,
      baseline: response.baseline,
      adjusted: response.adjusted,
      optimized: response.optimize,
      mode: mode === 'opt' ? 'opt' : 'view'
    });
    response.decisionReportsBundle = {
      baselineCsv: reportsBundle.baselineCsv,
      decisionCsv: reportsBundle.decisionCsv,
      summaries: reportsBundle.summaries,
      meta: reportsBundle.meta
    };
    response.decisionCsv = reportsBundle.decisionCsv;
    response.summaries = reportsBundle.summaries;

    const reportsArray = [];
    if (response.adjusted?.explain) {
      reportsArray.push(
        toReportEntry(
          'Adjusted',
          Number.isFinite(targetValue) ? targetValue : mostLikely,
          response.adjusted.explain.baselineProb,
          response.adjusted.explain.finalProb,
          response.adjusted.explain,
          null
        )
      );
    }
    if (response.optimize?.explain) {
      reportsArray.push(
        toReportEntry(
          response.optimize?.status === 'manual' ? 'Manual' : 'Optimize',
          Number.isFinite(targetValue) ? targetValue : mostLikely,
          response.optimize.explain.baselineProb,
          response.optimize.explain.finalProb,
          response.optimize.explain,
          response.optimize.certificate
        )
      );
    }
    response.decisionReports = reportsArray.filter(Boolean);

    return response;
  } catch (e) {
    const { message, details, stack } = extractError(e);
    return {
      schemaVersion: SCHEMA_VERSION,
      buildInfo: BUILD_INFO,
      error: message,
      details,
      stack
    };
  }
}

/* ------------------------------------------------------------------ *
 * API entry
 * ------------------------------------------------------------------ */
function projectcareAPI(tasks) {
  try {
    if (!Array.isArray(tasks) || tasks.length === 0) {
      throw new Error('Tasks must be a non-empty array');
    }
    const results = [];
    const feedbackMessages = [];
    for (const t of tasks) {
      const r = processTask(t);
      results.push(r);
      if (r?.error) feedbackMessages.push(`Failed to process task ${t?.task || 'unnamed'}: ${r.error}`);
    }
    return { results, error: null, details: {}, feedbackMessages };
  } catch (e) {
    const { message, details } = extractError(e);
    return { results: [], error: message, details, feedbackMessages: [message] };
  }
}

// Browser alias — index.html calls pmcEstimatorAPI(); GAS webapp.gs calls projectcareAPI()
// Both names resolve to the same function so shared/saco/main.js works in both environments.
var pmcEstimatorAPI = projectcareAPI;
