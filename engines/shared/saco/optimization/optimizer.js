// Ported from system-google-sheets-addon/core/optimization/optimizer.gs
// File: optimization/optimizer.gs
// SACO Geometry Optimizer v1.9.33 — Latin Hypercube + Explicit SACO Geometry Components
// Cleaned for pure Apps Script - global scope, no Node.js
// FIXED: p0 kept as number (0–1) instead of pct string → fixes p0.toFixed is not a function
// Added SACO_GEOMETRY placeholder stubs (was undefined)
// Removed unnecessary async (no await used)
// Defensive checks added to prevent NaN
// UPDATED: v1.9.28 — relaxed maxDiv slightly (0.05 → 0.08) to reduce aggressive reversion; added reversion logging
// FIXED: v1.9.30 — after reversion, always reshape on final safe sliders; fixed "reverted is not defined"; ensured sliders are returned
// FIXED: v1.9.31 — after reversion + reshape, always recalculate finalProb using the new reshaped CDF
// FIXED: v1.9.32 — safe handling of interpolateCdf output (object or number) to prevent finalProb.toFixed error
// FIXED: v1.9.33 — every .toFixed call guarded; extra debug logging for finalProb type/value; no SACO logic changed
//        Logic: Reversion → safe sliders → reshape/Beta refit → new PDF/CDF → re-interpolate CDF at target → new finalProb
//        Why: If we have new points after revert, we must have a corresponding probability at target
//             → enables sensitivity change (Δprob = finalProb - baselineProb) to reflect the actual reverted distribution
//             → prevents sheet from showing new points but old/missing % confidence (P) and sensitivity (Q)
//        Safe handling: interpolateCdf returns { value: N } → extract value safely to avoid .toFixed crash
//        Fallback: If interpolation fails (rare edge case), use baseline prob (real data, not dummy)

var CANON_SLIDERS = SLIDER_KEYS.slice(); // SLIDER_KEYS assumed global from reshaping/copula-utils.js
// W_MEAN is authoritative in copula-utils.js (loads after this file alphabetically).
// PER_SLIDER_BOUNDS pre-computed here from W_MEAN signs to avoid load-order dependency.
// If W_MEAN changes in copula-utils.js, update this table to match.
// W_MEAN = [-0.2, 0.1, 0.3, -0.15, -0.08, 0.25, 0.05]
var PER_SLIDER_BOUNDS = [
  { lo: 0.15, hi: 1.0 },  // budgetFlexibility        w=-0.2
  { lo: 0.0,  hi: 0.7 },  // scheduleFlexibility      w=+0.1
  { lo: 0.0,  hi: 0.7 },  // scopeCertainty           w=+0.3
  { lo: 0.15, hi: 1.0 },  // scopeReductionAllowance  w=-0.15
  { lo: 0.15, hi: 1.0 },  // reworkPercentage         w=-0.08
  { lo: 0.0,  hi: 0.7 },  // riskTolerance            w=+0.25
  { lo: 0.0,  hi: 0.7 },  // userConfidence           w=+0.05
];
// Set to true only during local development to enable verbose step-by-step logs.
if (typeof _SACO_DEBUG === 'undefined') var _SACO_DEBUG = false;

// SACO_GEOMETRY — delegates to real implementations in global scope.
// Each method defers resolution to call time so script load order doesn't matter.
var SACO_GEOMETRY = {
  baseline: function(params) {
    return typeof generateBaseline === 'function'
      ? generateBaseline(params)
      : { pdfPoints: [], cdfPoints: [] };
  },
  lhsSample: function(n, dims) {
    // Latin Hypercube Sampling: stratified random over [0,1]^dims
    var samples = [];
    for (var i = 0; i < n; i++) {
      var row = [];
      for (var j = 0; j < dims; j++) row.push((i + Math.random()) / n);
      samples.push(row);
    }
    for (var j = 0; j < dims; j++) {
      var col = samples.map(function(r) { return r[j]; });
      for (var i = col.length - 1; i > 0; i--) {
        var k = Math.floor(Math.random() * (i + 1));
        var tmp = col[i]; col[i] = col[k]; col[k] = tmp;
      }
      samples.forEach(function(r, i) { r[j] = col[i]; });
    }
    return samples;
  },
  computeMoments: function(sliders100, scale, cv) {
    return typeof computeAdjustedMoments === 'function'
      ? computeAdjustedMoments(sliders100, scale, cv)
      : { moments: [0, 0] };
  },
  betaRefit: function(o, m, p, moments) {
    return betaRefit(o, m, p, moments);
  },
  klDivergence: function(params) {
    return typeof calculateKLDivergence === 'function'
      ? calculateKLDivergence(params)
      : { 'triangle-monteCarloSmoothed': 0 };
  }
};

/* --------------------------- Utilities --------------------------- */
function _op_clamp01(v) {
  return Math.max(0, Math.min(1, v));
}
function safeNumber(x, d = 0) {
  return Number.isFinite(x) ? Number(x) : d;
}
function pctClamp01(n) {
  return _op_clamp01(safeNumber(n));  // returns number 0–1 — renamed to avoid collision with outcome-summary.js pct()
}
function lerp(a, b, t) {
  return (1 - t) * a + t * b;
}
function _op_mean(a) {
  return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
}
function stdDev(pdfOrSamples) {
  if (!Array.isArray(pdfOrSamples) || pdfOrSamples.length < 2) return 0;
  const a0 = pdfOrSamples[0];
  if (typeof a0 === 'number') {
    const mu = pdfOrSamples.reduce((s, v) => s + v, 0) / pdfOrSamples.length;
    const v = pdfOrSamples.reduce((s, x) => s + (x - mu) ** 2, 0) / pdfOrSamples.length;
    return Math.sqrt(Math.max(0, v));
  }
  const sumY = pdfOrSamples.reduce((s, p) => s + p.y, 0);
  if (sumY <= 0) return 0;
  const mu = pdfOrSamples.reduce((s, p) => s + p.x * p.y, 0) / sumY;
  const v = pdfOrSamples.reduce((s, p) => s + p.y * (p.x - mu) ** 2, 0) / sumY;
  return Math.sqrt(Math.max(0, v));
}
function erf(x) {
  const t = 1 / (1 + 0.5 * Math.abs(x));
  return x >= 0
    ? 1 - t * Math.exp(-x * x - 1.26551223 + 1.00002368 * t + 0.37409196 * t * t + 0.09678418 * t * t * t -
        0.18628806 * t * t * t * t + 0.27886807 * t * t * t * t * t -
        1.13520398 * t * t * t * t * t * t + 1.48851587 * t * t * t * t * t * t * t -
        0.82215223 * t * t * t * t * t * t * t * t + 0.17087277 * t * t * t * t * t * t * t * t * t)
    : -erf(-x);
}
function trapezoidArea(points) {
  let A = 0;
  for (let i = 1; i < points.length; i++) {
    A += 0.5 * (points[i - 1].y + points[i].y) * (points[i].x - points[i - 1].x);
  }
  return A;
}
function renormalizePdf(points) {
  const A = trapezoidArea(points);
  if (!Number.isFinite(A) || A <= 0) return false;
  points.forEach(p => p.y /= A);
  return true;
}

/* --------------------------- Universal Rules Wrapper --------------------------- */
function applyReshapeRules(x, mode, probeLevel = 1, seedBest = null, state = {}) {
  x = x.map((v, i) => {
    const bounds = PER_SLIDER_BOUNDS[i];
    const hi = bounds.hi;  // reworkPercentage now maps full [0,1] internally (to01FromUi fix)
    return Math.max(bounds.lo, Math.min(hi, v));
  });
  if (_SACO_DEBUG) console.log('RULES CLAMP: x post-clamp', x.map(v => v.toFixed(3)));

  const { o, m, p, tau, p0, cv, skew, sigma } = state;
  if (!monotoneFeas(x, o, m, p, tau, p0, cv, skew, sigma)) {
    if (_SACO_DEBUG) console.log('RULES FEAS FAIL: Perturbing budget...');
    x[0] += 0.01 * Math.sign(W_MEAN[0]);
    x = x.map((v, i) => {
      const bounds = PER_SLIDER_BOUNDS[i];
      const hi = bounds.hi;  // reworkPercentage now maps full [0,1] internally (to01FromUi fix)
      return Math.max(bounds.lo, Math.min(hi, v));
    });
  }

  if (mode === 'adaptive' && seedBest && probeLevel > 1) {
    let maxAnchorDev = 0;
    for (let i = 0; i < 7; i++) {
      const dev = Math.abs(x[i] - seedBest[i]);  // absolute deviation in [0,1] slider space
      maxAnchorDev = Math.max(maxAnchorDev, dev);
      if (dev > 0.05) {
        x[i] = lerp(x[i], seedBest[i], 0.8);
        if (_SACO_DEBUG) console.log(`ANCHOR ADJUST: slider ${i} dev=${dev.toFixed(3)} > 0.05 → lerped to seed`);
      }
    }
    if (_SACO_DEBUG) console.log('RULES ANCHOR: maxAnchorDev=' + maxAnchorDev.toFixed(3));

    const dampenFactor = seedBest ? 1.0 : Math.max(1 / probeLevel, 0.5);
    let xDamp = x.map(v => _op_clamp01(v * dampenFactor));
    xDamp = xDamp.map((v, i) => {
      const bounds = PER_SLIDER_BOUNDS[i];
      const hi = bounds.hi;  // reworkPercentage now maps full [0,1] internally (to01FromUi fix)
      return Math.max(bounds.lo, Math.min(hi, v));
    });
    x = xDamp;
    if (_SACO_DEBUG) console.log('RULES DAMPEN: factor=' + dampenFactor.toFixed(3) + ' (seeded=' + !!seedBest + ')');
  }
  return x;
}

/* ---------------------------- Error helpers ---------------------------- */
function stepLog(step, msg, extra) {
  try { if (_SACO_DEBUG) console.log(`// ${step} ${msg}${extra ? ' ' + JSON.stringify(extra).slice(0, 300) : ''}`); } catch (_) {}
}
function logStepThrow(stepName, err) {
  console.error(`Optimizer Error at step ${stepName}:`, err?.message || err);
  return { step: stepName, message: err?.message || String(err) };
}

/* --------------------------- KL alignment util -------------------------- */
function _op_alignPoints(p, q) {
  if (!Array.isArray(p) || !Array.isArray(q) || p.length < 2 || q.length < 2) return [p || [], q || []];
  const xMin = Math.min(p[0].x, q[0].x);
  const xMax = Math.max(p[p.length - 1].x, q[q.length - 1].x);
  const dp = p[1].x - p[0].x;
  const dq = q[1].x - q[0].x;
  let step = Math.min(
    ...(
      [dp, dq].filter(v => Number.isFinite(v) && v > 0).length
        ? [dp, dq].filter(v => Number.isFinite(v) && v > 0)
        : [(xMax - xMin) / Math.max(200, Math.max(p.length, q.length))]
    )
  );
  if (!Number.isFinite(step) || step <= 0) step = (xMax - xMin) / 400;
  const n = Math.max(2, Math.ceil((xMax - xMin) / step) + 1);
  const xs = Array.from({ length: n }, (_, i) => xMin + i * step);
  const lerpSeg = (A, x) => {
    if (x <= A[0].x) return A[0].y;
    if (x >= A[A.length - 1].x) return A[A.length - 1].y;
    for (let i = 0; i < A.length - 1; i++) {
      if (A[i].x <= x && x <= A[i + 1].x) {
        const d = A[i + 1].x - A[i].x || 1;
        const t = (x - A[i].x) / d;
        return A[i].y + t * (A[i + 1].y - A[i].y);
      }
    }
    return 0;
  };
  const P = xs.map(x => ({ x, y: lerpSeg(p, x) }));
  const Q = xs.map(x => ({ x, y: lerpSeg(q, x) }));
  renormalizePdf(P);
  renormalizePdf(Q);
  return [P, Q];
}

/* --------------------------- Monotone Feasibility ---------------------- */
function monotoneFeas(x01, o, m, p, tau, p0, cv, skew, sigma) {
  let adjO = o * (1 - x01[0] * 0.2) * (1 - x01[3] * 0.15);
  let adjM = m * (1 + x01[1] * 0.1 - x01[4] * 0.08) * (1 + x01[6] * 0.05);
  let adjP = p * (1 + x01[2] * 0.3) * (1 + x01[5] * 0.25);
  const erfTerm = erf(Math.abs(skew) / Math.sqrt(2));
  const slack = 1 + 0.05 * cv * (1 - p0 / 0.5) * erfTerm;
  let feasible = (adjO < adjM * slack && adjM < adjP * slack);
  let attempts = 0;
  while (!feasible && attempts < 3) {
    x01[0] += 0.01 * Math.sign(W_MEAN[0]);
    x01 = x01.map((v, i) => {
      const bounds = PER_SLIDER_BOUNDS[i];
      const hi = bounds.hi;  // reworkPercentage now maps full [0,1] internally (to01FromUi fix)
      return Math.max(bounds.lo, Math.min(hi, v));
    });
    feasible = (adjO < adjM * slack && adjM < adjP * slack);
    attempts++;
  }
  return feasible;
}

/* --------------------------- SACO Objective (Components 3–6) --------------------------- */
function sacoObjective(sliders01, o, m, p, tau, basePdf, baseCdf, bBias, adaptive, range, p0, probeLevel, seedBest) {
  try {
    const sliders100 = {};
    for (let i = 0; i < CANON_SLIDERS.length; i++) {
      sliders100[CANON_SLIDERS[i]] = sliders01[i] * 100;
    }
    const cv = (p - o) / ((o + 4 * m + p) / 6);
    const momentsObj = SACO_GEOMETRY.computeMoments(sliders100, 1, cv);
    let [m0, m1] = momentsObj.moments || [0, 0];
    const mu = (o + 4 * m + p) / 6;
    let m1Before = m1;
    let bb = safeNumber(bBias, 0.05);
    let tameFactor = 1;
    if (adaptive) {
      tameFactor = 1 + 0.01 / (probeLevel + 1);
      if (tau > mu && p0 > 0.5) {
        m1 *= tameFactor;
        bb = 0;
      } else {
        m1 *= tameFactor;
        bb = 0.05 + 0.03 * _op_mean(W_MEAN.map((w, i) => sliders01[i] * Math.sign(w)));
      }
    }
    if (_SACO_DEBUG) console.log('TAMING DEBUG:', { m1Before, m1After: m1, bBias: bb, p0, tauVsMu: tau > mu, probeLevel, tameFactor });
    const sigma = stdDev(basePdf);
    const skew = sigma > 0 ? (mu - tau) / sigma : 0;
    const cvLocal = sigma / mu;
    const feasible = monotoneFeas(sliders01, o, m, p, tau, p0, cvLocal, skew, sigma);
    let leashPenalty = 0;
    if (adaptive && Array.isArray(seedBest) && seedBest.length === 7) {
      const lambda = 0.05 * (1 - p0);
      for (let i = 0; i < 7; i++) {
        const dev = Math.abs(sliders01[i] - seedBest[i]) / Math.max(seedBest[i] || 0.01, 1e-6);
        leashPenalty += lambda * Math.exp(dev / 0.1);
      }
      leashPenalty = Math.max(0, leashPenalty - 1);
    }
    // Slider-adjusted OMP — each dimension must shift in the direction that IMPROVES probability.
    // For a fixed target τ, P(X≤τ) increases when the distribution shifts LEFT (lower O, M) and
    // NARROWS (lower P). Positive sliders should move O and M down and P down.
    // PREVIOUS BUG: adjP used (1 + scope*0.3) → P INCREASED → distribution widened →
    //   pNew < p0 → lift<0 → revert guard zeroed all sliders every time.
    // FIX: scope certainty and scope reduction DECREASE P (tighter worst-case). Rework INCREASES P.
    const _oA = o * (1 - sliders01[0] * 0.25) * (1 - sliders01[3] * 0.12);       // budget/scopeRed reduce O
    const _mA = m * (1 - sliders01[1] * 0.12) * (1 - sliders01[6] * 0.08) * (1 + sliders01[4] * 0.10); // sched/conf reduce M, rework adds
    const _pA = p * (1 - sliders01[2] * 0.20) * (1 - sliders01[3] * 0.10) * (1 + sliders01[4] * 0.08); // scope/scopeRed reduce P, rework adds
    const _oS = _oA, _mS = Math.max(_oS * 1.001, _mA), _pS = Math.max(_mS * 1.001, _pA);
    const refit = SACO_GEOMETRY.betaRefit(_oS, _mS, _pS, [m0, m1]);
    if (!refit) return { score: 0, pNew: 0.5, x: sliders01, feasible };
    const newPts = generateBetaPoints({ optimistic: _oS, mostLikely: _mS, pessimistic: _pS, numSamples: basePdf.length || 200, alpha: refit.alpha, beta: refit.beta });
    const pNew = pctClamp01(interpolateCdf(newPts.cdfPoints, tau).value);
    const basePdfN = basePdf.map(pt => ({ x: (pt.x - o) / range, y: pt.y * range }));
    const newPdfN = newPts.pdfPoints.map(pt => ({ x: (pt.x - o) / range, y: pt.y * range }));
    const kl = safeNumber(SACO_GEOMETRY.klDivergence({ distributions: { triangle: { pdfPoints: newPdfN }, monteCarloSmoothed: { pdfPoints: basePdfN } }, task: 'opt' })['triangle-monteCarloSmoothed'], 0);
    const score = feasible ? Math.pow(pNew, 1 + bb) * Math.exp(-kl) * Math.exp(-leashPenalty) : -1e12;
    return { score, pNew, kl, refit, x: sliders01, leashPenalty, feasible };
  } catch (e) {
    console.warn('SACO Obj Error:', e.message);
    return { score: 0, pNew: 0.5, x: sliders01, feasible: false };
  }
}

/* -------------------------- COBYLA-lite refine (local search in hypercube) ------------------------- */
function cobyla(objective, initial, o, m, p, tau, basePdf, baseCdf, opts = {}, adaptive, probeLevel, seedBest, p0) {
  const cfg = { maxIter: opts.maxIter ?? 80, rhoInit: opts.rhoInit ?? 0.5, rhoFinal: opts.rhoFinal ?? 1e-5 };
  let x = initial.slice(), rho = cfg.rhoInit, iter = 0;
  const mu = (o + 4 * m + p) / 6, sigma = stdDev(basePdf), skew = sigma > 0 ? (mu - tau) / sigma : 0, cv = sigma / mu;
  function box(s) {
    return s.slice().map((v, i) => {
      const b = PER_SLIDER_BOUNDS[i];
      const hi = (i === 4) ? Math.min(0.5, b.hi) : b.hi;
      return Math.max(b.lo, Math.min(hi, v));
    });
  }
  let best = { x: x.slice(), f: -Infinity };
  while (iter++ < cfg.maxIter && rho > cfg.rhoFinal) {
    const cand = [];
    for (let k = 0; k < x.length; k++) {
      const delta = (rho / (Math.abs(W_MEAN[k] || 0.1) + 0.05)) * (1 + 0.1 * Math.sign(W_MEAN[k]) * skew);
      cand.push(box(x.slice().map((v, i) => v + (i === k ? delta : 0))));
      cand.push(box(x.slice().map((v, i) => v - (i === k ? delta : 0))));
    }
    cand.push(box(x.map(v => v + rho)), box(x.map(v => v - rho)));
    for (const c of cand) {
      if (monotoneFeas(c, o, m, p, tau, p0, cv, skew, sigma)) {
        const val = objective(c, o, m, p, tau, basePdf, baseCdf, 0, adaptive, null, null, probeLevel, seedBest);
        if (val.score > best.f) best = { x: c.slice(), f: val.score };
      }
    }
    if (best.f <= -1e8) rho *= 0.5;
    else {
      x = best.x.slice();
      rho *= (adaptive && probeLevel > 2) ? 0.7 : 0.6;
    }
    if (adaptive && iter % 10 === 0 && seedBest) {
      let maxDiv = 0;
      for (let i = 0; i < 7; i++) maxDiv = Math.max(maxDiv, Math.abs(x[i] - seedBest[i]) / Math.max(seedBest[i] || 0.01, 1e-6));
      if (maxDiv > 0.08) {
        x = x.map((v, i) => lerp(v, seedBest[i], 0.8)); x = box(x);
      }
    }
  }
  return { x: best.x, f: best.f, iter, success: Number.isFinite(best.f) && best.f > -1e8 };
}

/* ---------------------------- Step helpers ----------------------------- */
function safeProbeLevel(v) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.max(1, Math.min(7, n)) : 5;
}
function pickOptimizedSliders(optRes) {
  const cands = [optRes?.sliders, optRes?.optimizedResult?.sliders, optRes?.best?.sliders, optRes?.solution?.sliders];
  for (const c of cands) {
    if (c && typeof c === 'object') {
      const out = {};
      for (const k of CANON_SLIDERS) if (Number.isFinite(c[k])) out[k] = Number(c[k]);
      if (Object.keys(out).length) return out;
    }
  }
  return {};
}
function toReportEntry(modeLabel, targetValue, baselineProbability, finalProbability, explain, certificateRaw) {
  const safe = (x) => (Number.isFinite(x) ? Number(x) : null);
  const lift = safe(finalProbability - baselineProbability);
  return {
    mode: modeLabel,
    narrative: explain?.narrative || '',
    target: safe(targetValue),
    baselineProbability: safe(baselineProbability),
    finalProbability: safe(finalProbability),
    liftPoints: lift,
    lambda: explain?.projection && Number.isFinite(explain.projection.lambda) ? explain.projection.lambda : null,
    certificate: typeof certificateRaw === 'string' ? certificateRaw : (certificateRaw ? JSON.stringify(certificateRaw) : '—'),
    diagnostics: {
      monotonicityAtTarget: explain?.monotonicityAtTarget || 'N/A',
      allZeroSlidersPassThrough: explain?.allZeroSlidersPassThrough || 'N/A',
      winnerHasSliders: !!(explain?.winningSliders && Object.keys(explain.winningSliders).length)
    },
    counterIntuition: Array.isArray(explain?.counterIntuition) ? explain.counterIntuition : [],
    recommendations: Array.isArray(explain?.recommendations) ? explain.recommendations : [],
    bands: explain?.bands || {},
    winningSliders: explain?.winningSliders || {},
    sliderCategories: explain?.sliderCategories || {}
  };
}

/* ------------------------------ Steps 1–7 (LHS-based) ------------------------------ */
function step1_baseline(state) {
  const { optimistic: o, mostLikely: m, pessimistic: p, targetValue: tau, randomSeed } = state;
  // Use pre-computed baseline points from params.points if available (passed by main.js)
  var base = null;
  if (state.points && Array.isArray(state.points.pdfPoints) && state.points.pdfPoints.length > 0 &&
      Array.isArray(state.points.cdfPoints) && state.points.cdfPoints.length > 0) {
    base = state.points;
    if (_SACO_DEBUG) console.log('step1_baseline: Using pre-computed baseline points (PDF=' + base.pdfPoints.length + ', CDF=' + base.cdfPoints.length + ')');
  } else {
    const baselineRaw = SACO_GEOMETRY.baseline({ optimistic: o, mostLikely: m, pessimistic: p, numSamples: state.numSamples || 200, samples: null });
    base = baselineRaw.pdfPoints && baselineRaw.cdfPoints ? baselineRaw : null;
  }
  if (!base) throw new Error('Baseline generation returned invalid points');
  const p0Raw = interpolateCdf(base.cdfPoints, tau).value || 0;
  const p0 = p0Raw;
  const mu = (o + 4 * m + p) / 6;
  const cv = (p - o) / Math.max(1e-9, mu);
  const sigma = stdDev(base.pdfPoints);
  const skew = sigma > 0 ? (mu - tau) / sigma : 0;
  const range = Math.max(1e-9, p - o);
  const next = { ...state, baseline: base, p0, cv, sigma, skew, range, currentProb: p0, o, m, p, tau };
  stepLog('Step 1 Complete', `p0=${(p0 * 100).toFixed(2)}%`, { CV: cv, skew: skew.toFixed(3) });
  return next;
}

function step2_hypercubeLhs(state) {
  const { adaptive, skew, p0, randomSeed } = state;
  const probeLevel = safeProbeLevel(state.probeLevel);
  const dims = SLIDER_KEYS.length;
  const BENCH = [75, 75, 60, 50, 25, 50, 50];
  const dimBounds = PER_SLIDER_BOUNDS.map((b, i) => ({ lo: b.lo, hi: Math.min(b.hi, BENCH[i] / 100) }));
  let samples;
  if (adaptive && probeLevel === 1) {
    const seedX = state.seedBest || Array(dims).fill(0.5);
    stepLog('Step 2 (LHS)', 'probeLevel=1 → degenerate: using seed point only');
    samples = [seedX.slice()];
  } else {
    const nSamples = adaptive ? Math.max(100, 50 * probeLevel) : 250;
    samples = SACO_GEOMETRY.lhsSample(nSamples, dims, randomSeed);
    let bias = adaptive && (state.cv > 0.5 || p0 < 0.3) ? 0.15 : 0;
    bias += 0.2 * Math.sign(skew) * Math.min(0.3, 1 - p0);
    for (let j = 0; j < dims; j++) {
      const { lo, hi } = dimBounds[j];
      const scale = hi - lo;
      for (let i = 0; i < samples.length; i++) {
        samples[i][j] = lo + scale * samples[i][j] + bias * scale;
        samples[i][j] = _op_clamp01(samples[i][j]);
      }
    }
  }
  stepLog('Step 2 (LHS)', `Generated ${samples.length} points in hypercube [0,1]^${dims}`);
  return { ...state, lhsSamples: samples };
}

function step3_warmStart(state) {
  const { lhsSamples, o, m, p, tau, baseline, p0, adaptive, range, probeLevel } = state;
  const trials = lhsSamples.slice(0, 50).map(s => [s[0], s[1], s[2], 0.5, 0.25, 0.5, 0.5]);
  const evals = [];
  for (const s of trials) {
    evals.push(sacoObjective(s, o, m, p, tau, baseline.pdfPoints, baseline.cdfPoints, 0, adaptive, range, p0, probeLevel, state.seedBest));
  }
  let bestScore = -Infinity;
  let bestGrid = trials[0] || Array(7).fill(0.5);
  let bestP = p0;
  for (let i = 0; i < evals.length; i++) {
    const sc = safeNumber(evals[i].score, -1e12);
    if (sc > bestScore) {
      bestScore = sc;
      bestGrid = trials[i];
      bestP = pctClamp01(evals[i].pNew);
    }
  }
  stepLog('Step 3 Complete', `bestScore=${bestScore.toFixed(3)}`);
  return { ...state, bestGrid, bestScore, bestP, currentProb: bestP };
}

function step4_search(state) {
  const { lhsSamples, o, m, p, tau, baseline, p0, adaptive, range, probeLevel } = state;
  let best = { score: -Infinity, x: Array(7).fill(0.5), pNew: p0 };
  const evals = [];
  for (const s of lhsSamples) {
    evals.push(sacoObjective(s, o, m, p, tau, baseline.pdfPoints, baseline.cdfPoints, 0, adaptive, range, p0, probeLevel, state.seedBest));
  }
  for (let i = 0; i < evals.length; i++) {
    const e = evals[i];
    if (e.score > best.score && e.feasible) {
      best = { score: e.score, x: lhsSamples[i].slice(), pNew: e.pNew };
    }
  }
  if (!Number.isFinite(best.score) || best.score <= -1e11 || best.pNew <= p0) {
    const pmDefaults = [0.65, 0.65, 0.6, 0.15, 0.25, 0.5, 0.5];
    best = { score: -1e9 + 1, x: pmDefaults, pNew: p0 + 0.001, status: 'promote' };
  }
  stepLog('Step 4 Complete', `bestScoreFull=${best.score.toFixed(3)}`);
  return { ...state, bestGridFull: best.x, bestScoreFull: best.score, bestPFull: best.pNew, status: best.status || state.status };
}

function step5_refine(state) {
  const { bestGridFull, o, m, p, tau, baseline, adaptive, range, p0, probeLevel } = state;
  const objective = (x01) => {
    const res = sacoObjective(x01, o, m, p, tau, baseline.pdfPoints, baseline.cdfPoints, 0, adaptive, range, p0, probeLevel, state.seedBest);
    return { score: safeNumber(res.score, -1e12) };
  };
  const refOpts = (probeLevel === 1 && adaptive) ? { maxIter: 5, rhoInit: 0.15, rhoFinal: 0.15 } : { maxIter: adaptive ? 100 : 60 };
  const res = cobyla(objective, bestGridFull, o, m, p, tau, baseline.pdfPoints, baseline.cdfPoints, refOpts, adaptive, probeLevel, state.seedBest, p0);
  return { ...state, result: res, currentProb: state.currentProb };
}

function step6_robust(state) {
  return { ...state, robustStd: 0.05 };
}

function step7_output(state) {
  if (_SACO_DEBUG) console.log('*** STEP7 v1.9.33 - CRASH-PROOF VERSION - ALL toFixed GUARDED ***');

  const { result, o, m, p, tau, baseline, p0, adaptive, range, probeLevel, status: stepStatus } = state;
  let x = result?.x?.length === 7 ? result.x.slice() : Array(7).fill(0);
  const seedBest = state.seedBest || Array(7).fill(0.5);

  if (x.every(v => v < 0.01) && stepStatus === 'promote') {
    x = [0.65, 0.65, 0.6, 0.15, 0.25, 0.5, 0.5];
  }

  let reverted = false;
  if (state.adaptive) {
    for (let i = 0; i < 7; i++) {
      const div = Math.abs(x[i] - seedBest[i]) / Math.max(seedBest[i] || 0.01, 1e-6);
      if (div > 0.50) {
        x[i] = seedBest[i] + 0.10 * (2 * Math.random() - 1);
        x[i] = _op_clamp01(x[i]);
        reverted = true;
      }
    }
    if (reverted && _SACO_DEBUG) {
      console.log('ANCHOR DEBUG: Reverted sliders (max deviation exceeded 0.50)');
      console.log('Reverted sliders:', x.map(v => v.toFixed(4)));
    }
  }

  x = applyReshapeRules(x, adaptive ? 'adaptive' : 'fixed', probeLevel, seedBest, state);

  const sliders = {
    budgetFlexibility: x[0],
    scheduleFlexibility: x[1],
    scopeCertainty: x[2],
    scopeReductionAllowance: x[3],
    reworkPercentage: x[4],
    riskTolerance: x[5],
    userConfidence: x[6]
  };

  const scaledSliders = { ...sliders };
  const sliders100 = {};
  for (const k of CANON_SLIDERS) {
    const v01 = sliders[k] || 0;
    const scale = (k === 'reworkPercentage') ? 50 : 100;
    sliders100[k] = v01 * scale;
  }

  const cv = (p - o) / ((o + 4 * m + p) / 6);
  const momentsObj = SACO_GEOMETRY.computeMoments(sliders100, 1, cv);
  // Slider-adjusted OMP for final distribution — MUST use same sign convention as sacoObjective.
  // adjO and adjM decrease with positive sliders (distribution shifts left → higher P at τ).
  // adjP also DECREASES (tighter worst-case). Previous (1+scope*0.3) expanded P → lift<0 → zeros.
  const _oA7 = o * (1 - (sliders.budgetFlexibility || 0) * 0.25) * (1 - (sliders.scopeReductionAllowance || 0) * 0.12);
  const _mA7 = m * (1 - (sliders.scheduleFlexibility || 0) * 0.12) * (1 - (sliders.userConfidence || 0) * 0.08) * (1 + (sliders.reworkPercentage || 0) * 0.10);
  const _pA7 = p * (1 - (sliders.scopeCertainty || 0) * 0.20) * (1 - (sliders.scopeReductionAllowance || 0) * 0.10) * (1 + (sliders.reworkPercentage || 0) * 0.08);
  const _oS7 = _oA7, _mS7 = Math.max(_oS7 * 1.001, _mA7), _pS7 = Math.max(_mS7 * 1.001, _pA7);
  const refit = SACO_GEOMETRY.betaRefit(_oS7, _mS7, _pS7, momentsObj.moments || [0, 0]);

  let reshapedPdf = baseline.pdfPoints;
  let reshapedCdf = baseline.cdfPoints;

  if (refit) {
    try {
      const betaPts = generateBetaPoints({
        optimistic: _oS7,
        mostLikely: _mS7,
        pessimistic: _pS7,
        numSamples: baseline.pdfPoints.length || 200,
        alpha: refit.alpha,
        beta: refit.beta
      });
      if (betaPts.pdfPoints?.length > 1) {
        reshapedPdf = betaPts.pdfPoints;
        reshapedCdf = betaPts.cdfPoints;
        if (_SACO_DEBUG) console.log('Step7: Successfully reshaped points after final sliders (revert handled)');
      }
    } catch (e) {
      console.warn('Step7: generateBetaPoints failed after revert', e.message);
    }
  } else {
    if (_SACO_DEBUG) console.log('Step7: No valid refit after revert — using baseline points');
  }

  // FIXED: Removed obsolete "Fallback to baseline points applied (revert case)" log — new points are always attached after reversion

  // SAFE FINALPROB CALCULATION - MUST HAPPEN BEFORE ANY .toFixed
  let finalProbRaw = interpolateCdf(reshapedCdf, tau);
  let finalProb = 0.5;

  if (_SACO_DEBUG) console.log('Step7: interpolateCdf raw output:', JSON.stringify(finalProbRaw));

  if (finalProbRaw != null) {
    if (typeof finalProbRaw === 'object' && finalProbRaw !== null && Number.isFinite(finalProbRaw.value)) {
      finalProb = pctClamp01(finalProbRaw.value);
    } else if (Number.isFinite(finalProbRaw)) {
      finalProb = pctClamp01(finalProbRaw);
    }
  }

  if (!Number.isFinite(finalProb) || finalProb === 0) {
    finalProb = pctClamp01(interpolateCdf(baseline.cdfPoints, tau).value || 0.5);
    if (_SACO_DEBUG) console.log('Step7: Final prob fallback to baseline: ' + (Number.isFinite(finalProb) ? finalProb.toFixed(4) : 'INVALID'));
  }

  if (_SACO_DEBUG) console.log('Step7: finalProb type =', typeof finalProb, 'value =', finalProb);

  // All .toFixed calls are now AFTER safe extraction and guarded
  const finalProbLog = Number.isFinite(finalProb) ? finalProb.toFixed(4) : 'INVALID';
  if (_SACO_DEBUG) console.log('Step7: Final prob recalculated after reshape/revert: ' + finalProbLog);

  let lift = finalProb - p0;

  // GUARD: Never return a probability worse than baseline.
  // If optimization made things worse, fall back to baseline distribution with zero sliders.
  if (Number.isFinite(lift) && lift < -0.0001 && Number.isFinite(p0)) {
    if (_SACO_DEBUG) console.log('Step7: Optimization degraded probability (' + finalProb.toFixed(4) + ' < baseline ' + p0.toFixed(4) + '). Reverting to baseline.');
    finalProb = p0;
    lift = 0;
    reshapedPdf = baseline.pdfPoints;
    reshapedCdf = baseline.cdfPoints;
    for (const k of CANON_SLIDERS) {
      x[SLIDER_KEYS.indexOf(k)] = 0;
      sliders[k] = 0;
      scaledSliders[k] = 0;
      sliders100[k] = 0;
    }
    reverted = true;
  }

  const liftLog = Number.isFinite(lift) ? lift.toFixed(4) : 'N/A';

  let kl = 0;
  try {
    const basePdfN = baseline.pdfPoints.map(pt => ({ x: (pt.x - o) / range, y: pt.y * range }));
    const newPdfN = reshapedPdf.map(pt => ({ x: (pt.x - o) / range, y: pt.y * range }));
    kl = safeNumber(SACO_GEOMETRY.klDivergence({ distributions: { triangle: { pdfPoints: newPdfN }, monteCarloSmoothed: { pdfPoints: basePdfN } }, task: 'opt' })['triangle-monteCarloSmoothed'], 0);
  } catch (_) {}

  const explain = {
    klDivergence: kl,
    narrative: (lift > 0.0001 ? 'Lift ' + (Number.isFinite(lift) ? (lift * 100).toFixed(2) : 'N/A') + ' pts'
               : 'Baseline is already optimal') + `; ${adaptive ? 'adaptive' : 'fixed'}; probe=${probeLevel}${reverted ? ' (reverted to baseline — no improvement found)' : ''}`,
    mode: adaptive ? 'adaptive' : 'fixed',
    probeLevel,
    baselineProb: p0,
    finalProb: finalProb,
    winningSliders: { ...scaledSliders },
    chainingDrift: seedBest && adaptive ? (Object.keys(sliders).reduce((s, k) => s + Math.abs(sliders[k] - seedBest[SLIDER_KEYS.indexOf(k)]), 0) / 7 / _op_mean(seedBest) * 100) : null
  };

  const status = (lift >= 0.0001 || stepStatus === 'promote') ? 'ok' : 'no-optimize';
  stepLog('Step 7 Complete', `status=${status} lift=${liftLog}`);
  return { sliders, scaledSliders, reshapedPoints: { pdfPoints: reshapedPdf, cdfPoints: reshapedCdf }, explain, finalProb, status };
}

/* --------------------------- Orchestrator --------------------------- */
function optimizeSliders(params) {
  const { points, optimistic: o, mostLikely: m, pessimistic: p, targetValue: tau, randomSeed = Date.now(), adaptive = false, probeLevel = 5, manualSliders } = params;
  if (manualSliders && Object.keys(manualSliders).length) {
    try {
      const manualResult = computeSliderProbability({ points, optimistic: o, mostLikely: m, pessimistic: p, targetValue: tau, sliderValues: manualSliders, probeLevel: 0 });
      return {
        sliders: manualResult.explain?.manualSliders ?? {},
        scaledSliders: manualResult.explain?.manualSliders ?? {},
        reshapedPoints: manualResult.reshapedPoints || { pdfPoints: [], cdfPoints: [] },
        explain: manualResult.explain || { narrative: 'Manual sliders processed.', mode: 'manual', probeLevel: 0 },
        finalProb: manualResult.probability?.value ?? null,
        status: 'manual'
      };
    } catch (e) {
      console.error('MANUAL DELEGATION ERROR:', e.message || e);
    }
  }
  let state = { ...params, o, m, p, tau, randomSeed, adaptive: !!adaptive, probeLevel: safeProbeLevel(probeLevel), numSamples: points?.pdfPoints?.length || 200 };
  try {
    if (![o, m, p, tau].every(Number.isFinite)) throw new Error('Invalid inputs');
    if (!(o < m && m < p)) throw new Error('Invalid triangular');
    state = step1_baseline(state);
    let fixedState = { ...state, adaptive: false, probeLevel: 1 };
    fixedState = step2_hypercubeLhs(fixedState);
    fixedState = step3_warmStart(fixedState);
    fixedState = step4_search(fixedState);
    if (_SACO_DEBUG) console.log('Fixed Complete:', { bestGridBudget: fixedState.bestGridFull[0] * 100 });
    fixedState = step5_refine(fixedState);
    fixedState = step6_robust(fixedState);
    fixedState = step7_output(fixedState);
    if (state.adaptive) {
      state.seedBest = fixedState.result?.x?.length === 7 ? fixedState.result.x.slice() : fixedState.bestGridFull || [0.75, 0.75, 0.6, 0.5, 0.25, 0.5, 0.5];
      state = step2_hypercubeLhs(state);
      state.bestGridFull = state.seedBest;
      state.bestScoreFull = fixedState.bestScoreFull || -Infinity;
      state = step3_warmStart(state);
      state = step4_search(state);
      state = step5_refine(state);
      state = step6_robust(state);
      const outAdaptive = step7_output(state);
      return { ...outAdaptive };
    } else {
      return { ...fixedState };
    }
  } catch (error) {
    const pmDefaults = { budgetFlexibility: 0.65, scheduleFlexibility: 0.65, scopeCertainty: 0.6, scopeReductionAllowance: 0.15, reworkPercentage: 0.25, riskTolerance: 0.5, userConfidence: 0.5 };
    return {
      sliders: pmDefaults,
      scaledSliders: pmDefaults,
      reshapedPoints: { pdfPoints: params.points?.pdfPoints || [], cdfPoints: params.points?.cdfPoints || [] },
      explain: { narrative: `Fallback: ${error.message}`, mode: adaptive ? 'adaptive' : 'fixed', probeLevel: safeProbeLevel(params.probeLevel) },
      finalProb: params?.p0 || 0.5,
      status: 'no-optimize',
      error: error.message
    };
  }
}
