/**
 * ProjectCare — SACO Optimizer
 * Ported from GAS: core/optimization/optimizer.gs + kl-divergence.gs
 *
 * Two-stage optimization:
 *   Stage 1 — Latin Hypercube Sampling (global exploration, stratified per dimension)
 *   Stage 2 — COBYLA-lite (gradient-free local refinement)
 *
 * Objective: maximize P(X ≤ τ)^(1+bb) · exp(−KL) · exp(−leash)
 * All pure math — no DOM, no network.
 *
 * Exposes: window.PMCOptimizer
 * Depends on: window.PMCBaseline, window.PMCCopula
 */

(function (root) {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Cross-module references (resolved lazily at call time)             */
  /* ------------------------------------------------------------------ */
  function B() { return root.PMCBaseline; }
  function C() { return root.PMCCopula; }

  /* ------------------------------------------------------------------ */
  /* Internal utilities                                                   */
  /* ------------------------------------------------------------------ */

  function clamp01(v) { return Math.max(0, Math.min(1, Number(v) || 0)); }
  function safeNumber(x, d) { return Number.isFinite(x) ? Number(x) : (d === undefined ? 0 : d); }
  function lerp(a, b, t) { return (1 - t) * a + t * b; }

  function arrMean(a) {
    if (!Array.isArray(a) || !a.length) return 0;
    return a.reduce(function (s, v) { return s + v; }, 0) / a.length;
  }

  function stdDev(pdfOrSamples) {
    if (!Array.isArray(pdfOrSamples) || pdfOrSamples.length < 2) return 0;
    var a0 = pdfOrSamples[0];
    if (typeof a0 === 'number') {
      var mu0 = arrMean(pdfOrSamples);
      var v0 = pdfOrSamples.reduce(function (s, x) { return s + (x - mu0) * (x - mu0); }, 0) / pdfOrSamples.length;
      return Math.sqrt(Math.max(0, v0));
    }
    /* Weighted mean/variance from PDF points */
    var sumY = pdfOrSamples.reduce(function (s, p) { return s + p.y; }, 0);
    if (sumY <= 0) return 0;
    var mu = pdfOrSamples.reduce(function (s, p) { return s + p.x * p.y; }, 0) / sumY;
    var v = pdfOrSamples.reduce(function (s, p) { return s + p.y * (p.x - mu) * (p.x - mu); }, 0) / sumY;
    return Math.sqrt(Math.max(0, v));
  }

  /** Error function — Horner form approximation (Abramowitz & Stegun 7.1.26). */
  function erf(x) {
    var t = 1 / (1 + 0.5 * Math.abs(x));
    var poly = -x * x - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
               t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 +
               t * (-0.82215223 + t * 0.17087277))))))));
    var res = 1 - t * Math.exp(poly);
    return x >= 0 ? res : -res;
  }

  /* ------------------------------------------------------------------ */
  /* SACO constants (mirrored from optimizer.gs)                        */
  /* ------------------------------------------------------------------ */

  var SLIDER_KEYS = [
    'budgetFlexibility', 'scheduleFlexibility', 'scopeCertainty',
    'scopeReductionAllowance', 'reworkPercentage', 'riskTolerance', 'userConfidence'
  ];

  /* Signed directional weights — defines which direction each slider improves P(X≤τ) */
  var W_MEAN = [-0.2, 0.1, 0.3, -0.15, -0.08, 0.25, 0.05];

  /* Per-slider [lo, hi] bounds derived from W_MEAN sign */
  var PER_SLIDER_BOUNDS = W_MEAN.map(function (w) {
    return { lo: w < 0 ? 0.15 : 0, hi: w > 0 ? 0.7 : 1.0 };
  });

  /* ------------------------------------------------------------------ */
  /* True Latin Hypercube Sampling — stratified + Fisher-Yates shuffle  */
  /* ------------------------------------------------------------------ */

  /**
   * Generate n LHS samples in k dimensions, each stratified into n equal intervals.
   * Uses a seeded-like shuffle (Mulberry32 PRNG) for reproducibility.
   */
  function lhsSample(n, k, seed) {
    seed = (seed === undefined || seed === null) ? Date.now() : seed;

    /* Mulberry32 PRNG (fast, good for simulation use) */
    var s = seed >>> 0;
    function rand() {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) >>> 0;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    /* Build n×k matrix */
    var samples = [];
    for (var i = 0; i < n; i++) {
      samples.push(new Array(k));
    }

    for (var j = 0; j < k; j++) {
      /* Create permutation via Fisher-Yates */
      var perm = [];
      for (var ii = 0; ii < n; ii++) perm.push(ii);
      for (var ii = n - 1; ii > 0; ii--) {
        var jj = Math.floor(rand() * (ii + 1));
        var tmp = perm[ii]; perm[ii] = perm[jj]; perm[jj] = tmp;
      }
      /* Assign stratified samples */
      for (var ii = 0; ii < n; ii++) {
        samples[ii][j] = (perm[ii] + rand()) / n;
      }
    }
    return samples;
  }

  /* ------------------------------------------------------------------ */
  /* SACO_GEOMETRY — wired to real PMCBaseline + PMCCopula               */
  /* ------------------------------------------------------------------ */

  var SACO_GEOMETRY = {

    lhsSample: lhsSample,

    computeMoments: function (sliders100, scale, cv) {
      var Cop = C();
      if (Cop && Cop.computeAdjustedMoments) {
        return Cop.computeAdjustedMoments(sliders100, scale, cv);
      }
      return { moments: [0, 0] };
    },

    betaRefit: function (o, m, p, moments) {
      var m0 = Array.isArray(moments) ? moments[0] : 0;
      var m1 = Array.isArray(moments) ? moments[1] : 0;
      var Cop = C();
      if (Cop && Cop.betaRefit) {
        return Cop.betaRefit(o, m, p, m0, m1);
      }
      /* Fallback inline */
      var mu0  = (o + 4 * m + p) / 6;
      var var0 = Math.pow((p - o) / 6, 2);
      var range = Math.max(1e-9, p - o);
      var mu1 = Math.max(o * 1.01, mu0 * (1 - clamp01(m0) * 0.2));
      var var1 = Math.max(1e-12, Math.min(var0, var0 * (1 - clamp01(m1) * 0.5)));
      var mu01  = clamp01((mu1 - o) / range);
      var var01 = Math.max(1e-12, var1 / (range * range));
      var denom = mu01 * (1 - mu01) / var01 - 1;
      var alpha = mu01 * denom, beta = (1 - mu01) * denom;
      if (!(alpha > 0 && beta > 0 && Number.isFinite(alpha) && Number.isFinite(beta))) return null;
      return { alpha: alpha, beta: beta };
    },

    klDivergence: function (params) {
      var Cop = C();
      if (Cop && Cop.computeKLDivergence) {
        return Cop.computeKLDivergence(params);
      }
      return { 'triangle-monteCarloSmoothed': 0 };
    }
  };

  /* ------------------------------------------------------------------ */
  /* Box clamp to per-slider bounds                                      */
  /* ------------------------------------------------------------------ */

  function boxClamp(s) {
    return s.slice().map(function (v, i) {
      var b = PER_SLIDER_BOUNDS[i];
      var hi = (i === 4) ? Math.min(0.5, b.hi) : b.hi;
      return Math.max(b.lo, Math.min(hi, v));
    });
  }

  /* ------------------------------------------------------------------ */
  /* Monotone feasibility check                                          */
  /* ------------------------------------------------------------------ */

  function monotoneFeas(x01, o, m, p, tau, p0, cv, skew, sigma) {
    var adjO = o * (1 - x01[0] * 0.2)  * (1 - x01[3] * 0.15);
    var adjM = m * (1 + x01[1] * 0.1 - x01[4] * 0.08) * (1 + x01[6] * 0.05);
    var adjP = p * (1 + x01[2] * 0.3)  * (1 + x01[5] * 0.25);
    var erfTerm = erf(Math.abs(skew) / Math.sqrt(2));
    var slack = 1 + 0.05 * cv * (1 - p0 / 0.5) * erfTerm;
    var feasible = (adjO < adjM * slack && adjM < adjP * slack);
    if (!feasible) {
      /* One gentle nudge */
      var xT = x01.slice();
      xT[0] += 0.01 * Math.sign(W_MEAN[0]);
      xT = boxClamp(xT);
      adjO = o * (1 - xT[0] * 0.2) * (1 - xT[3] * 0.15);
      adjM = m * (1 + xT[1] * 0.1 - xT[4] * 0.08) * (1 + xT[6] * 0.05);
      adjP = p * (1 + xT[2] * 0.3) * (1 + xT[5] * 0.25);
      feasible = (adjO < adjM * slack && adjM < adjP * slack);
    }
    return feasible;
  }

  /* ------------------------------------------------------------------ */
  /* Apply reshape rules (anchor + dampen for adaptive mode)            */
  /* ------------------------------------------------------------------ */

  function applyReshapeRules(x, mode, probeLevel, seedBest, state) {
    x = boxClamp(x);
    var o = state.o, m = state.m, p = state.p, tau = state.tau,
        p0 = state.p0, cv = state.cv, skew = state.skew, sigma = state.sigma;
    if (!monotoneFeas(x, o, m, p, tau, p0, cv, skew, sigma)) {
      x[0] += 0.01 * Math.sign(W_MEAN[0]);
      x = boxClamp(x);
    }
    if (mode === 'adaptive' && seedBest && probeLevel > 1) {
      for (var i = 0; i < 7; i++) {
        var div = Math.abs(x[i] - seedBest[i]) / Math.max(seedBest[i] || 0.01, 1e-6);
        if (div > 0.08) x[i] = lerp(x[i], seedBest[i], 0.8);
      }
      var dampenFactor = seedBest ? 1.0 : Math.max(1 / probeLevel, 0.5);
      x = boxClamp(x.map(function (v) { return clamp01(v * dampenFactor); }));
    }
    return x;
  }

  /* ------------------------------------------------------------------ */
  /* SACO objective function                                             */
  /* ------------------------------------------------------------------ */

  function sacoObjective(sliders01, o, m, p, tau, basePdf, baseCdf, bBias, adaptive, range, p0, probeLevel, seedBest) {
    try {
      var Bas = B();
      var sliders100 = {};
      for (var i = 0; i < SLIDER_KEYS.length; i++) {
        sliders100[SLIDER_KEYS[i]] = sliders01[i] * 100;
      }
      var cv = (p - o) / ((o + 4 * m + p) / 6);
      var momentsObj = SACO_GEOMETRY.computeMoments(sliders100, 1, cv);
      var mArr = momentsObj.moments || [0, 0];
      var m0 = mArr[0], m1 = mArr[1];
      var mu = (o + 4 * m + p) / 6;
      var bb = safeNumber(bBias, 0.05);

      if (adaptive) {
        var tameFactor = 1 + 0.01 / (probeLevel + 1);
        m1 *= tameFactor;
        if (!(tau > mu && p0 > 0.5)) {
          bb = 0.05 + 0.03 * arrMean(W_MEAN.map(function (w, i) { return sliders01[i] * Math.sign(w); }));
        } else {
          bb = 0;
        }
      }

      var sigma = stdDev(basePdf);
      var skew  = sigma > 0 ? (mu - tau) / sigma : 0;
      var cvLocal = sigma / mu;
      var feasible = monotoneFeas(sliders01, o, m, p, tau, p0, cvLocal, skew, sigma);

      var leashPenalty = 0;
      if (adaptive && Array.isArray(seedBest) && seedBest.length === 7) {
        var lambda = 0.05 * (1 - p0);
        for (var j = 0; j < 7; j++) {
          var dev = Math.abs(sliders01[j] - seedBest[j]) / Math.max(seedBest[j] || 0.01, 1e-6);
          leashPenalty += lambda * Math.exp(dev / 0.1);
        }
        leashPenalty = Math.max(0, leashPenalty - 1);
      }

      /* Adjusted OMP — all positive sliders shift distribution LEFT (better P at τ) */
      var _oA = o * (1 - sliders01[0] * 0.25) * (1 - sliders01[3] * 0.12);
      var _mA = m * (1 - sliders01[1] * 0.12) * (1 - sliders01[6] * 0.08) * (1 + sliders01[4] * 0.10);
      var _pA = p * (1 - sliders01[2] * 0.20) * (1 - sliders01[3] * 0.10) * (1 + sliders01[4] * 0.08);
      var _oS = _oA, _mS = Math.max(_oS * 1.001, _mA), _pS = Math.max(_mS * 1.001, _pA);

      var refit = SACO_GEOMETRY.betaRefit(_oS, _mS, _pS, [m0, m1]);
      if (!refit) return { score: 0, pNew: 0.5, x: sliders01, feasible: feasible };

      var numSamples = (basePdf && basePdf.length) ? basePdf.length : 200;
      var newPts = Bas ? Bas.generateBetaPoints({
        optimistic: _oS, mostLikely: _mS, pessimistic: _pS,
        numSamples: numSamples, alpha: refit.alpha, beta: refit.beta
      }) : { pdfPoints: [], cdfPoints: [] };

      var pNewRaw = Bas ? Bas.interpolateCdf(newPts.cdfPoints, tau) : { value: 0.5 };
      var pNew = clamp01(typeof pNewRaw === 'object' ? safeNumber(pNewRaw.value, 0.5) : safeNumber(pNewRaw, 0.5));

      var basePdfN = basePdf.map(function (pt) { return { x: (pt.x - o) / range, y: pt.y * range }; });
      var newPdfN  = newPts.pdfPoints.map(function (pt) { return { x: (pt.x - o) / range, y: pt.y * range }; });
      var klObj = SACO_GEOMETRY.klDivergence({ distributions: { triangle: { pdfPoints: newPdfN }, monteCarloSmoothed: { pdfPoints: basePdfN } }, task: 'opt' });
      var kl = safeNumber(klObj['triangle-monteCarloSmoothed'], 0);

      var score = feasible ? Math.pow(pNew, 1 + bb) * Math.exp(-kl) * Math.exp(-leashPenalty) : -1e12;
      return { score: score, pNew: pNew, kl: kl, refit: refit, x: sliders01, leashPenalty: leashPenalty, feasible: feasible };
    } catch (e) {
      return { score: 0, pNew: 0.5, x: sliders01, feasible: false };
    }
  }

  /* ------------------------------------------------------------------ */
  /* COBYLA-lite local refinement                                        */
  /* ------------------------------------------------------------------ */

  function cobyla(objective, initial, o, m, p, tau, basePdf, baseCdf, opts, adaptive, probeLevel, seedBest, p0) {
    opts = opts || {};
    var maxIter  = opts.maxIter  !== undefined ? opts.maxIter  : 80;
    var rhoInit  = opts.rhoInit  !== undefined ? opts.rhoInit  : 0.5;
    var rhoFinal = opts.rhoFinal !== undefined ? opts.rhoFinal : 1e-5;

    var x = initial.slice();
    var rho = rhoInit, iter = 0;
    var mu = (o + 4 * m + p) / 6;
    var sigma = stdDev(basePdf);
    var skew = sigma > 0 ? (mu - tau) / sigma : 0;
    var cv = sigma / mu;
    var best = { x: x.slice(), f: -Infinity };

    while (iter++ < maxIter && rho > rhoFinal) {
      var cand = [];
      for (var k = 0; k < x.length; k++) {
        var delta = (rho / (Math.abs(W_MEAN[k] || 0.1) + 0.05)) * (1 + 0.1 * Math.sign(W_MEAN[k]) * skew);
        cand.push(boxClamp(x.slice().map(function (v, i) { return v + (i === k ? delta : 0); })));
        cand.push(boxClamp(x.slice().map(function (v, i) { return v - (i === k ? delta : 0); })));
      }
      cand.push(boxClamp(x.map(function (v) { return v + rho; })));
      cand.push(boxClamp(x.map(function (v) { return v - rho; })));

      for (var ci = 0; ci < cand.length; ci++) {
        var c = cand[ci];
        if (monotoneFeas(c, o, m, p, tau, p0, cv, skew, sigma)) {
          var val = objective(c, o, m, p, tau, basePdf, baseCdf, 0, adaptive, null, null, probeLevel, seedBest);
          if (val.score > best.f) best = { x: c.slice(), f: val.score };
        }
      }

      if (best.f <= -1e8) {
        rho *= 0.5;
      } else {
        x = best.x.slice();
        rho *= (adaptive && probeLevel > 2) ? 0.7 : 0.6;
      }

      /* Adaptive anchor reversion every 10 iterations */
      if (adaptive && iter % 10 === 0 && seedBest) {
        var maxDiv = 0;
        for (var ii = 0; ii < 7; ii++) {
          maxDiv = Math.max(maxDiv, Math.abs(x[ii] - seedBest[ii]) / Math.max(seedBest[ii] || 0.01, 1e-6));
        }
        if (maxDiv > 0.08) {
          x = boxClamp(x.map(function (v, ii) { return lerp(v, seedBest[ii], 0.8); }));
        }
      }
    }
    return { x: best.x, f: best.f, iter: iter, success: Number.isFinite(best.f) && best.f > -1e8 };
  }

  /* ------------------------------------------------------------------ */
  /* Step helpers                                                         */
  /* ------------------------------------------------------------------ */

  function safeProbeLevel(v) {
    var n = Math.floor(Number(v));
    return Number.isFinite(n) ? Math.max(1, Math.min(7, n)) : 5;
  }

  /* ------------------------------------------------------------------ */
  /* Steps 1–7                                                           */
  /* ------------------------------------------------------------------ */

  function step1_baseline(state) {
    var Bas = B();
    var o = state.o, m = state.m, p = state.p, tau = state.tau;
    var base = null;

    if (state.points && Array.isArray(state.points.pdfPoints) && state.points.pdfPoints.length > 0 &&
        Array.isArray(state.points.cdfPoints) && state.points.cdfPoints.length > 0) {
      base = state.points;
    } else if (Bas && Bas.generateBaseline) {
      var raw = Bas.generateBaseline({ optimistic: o, mostLikely: m, pessimistic: p, numSamples: state.numSamples || 200 });
      base = (raw && raw.monteCarloSmoothed) ? { pdfPoints: raw.monteCarloSmoothed.pdfPoints, cdfPoints: raw.monteCarloSmoothed.cdfPoints } : null;
    }
    if (!base) throw new Error('Baseline generation returned invalid points');

    var p0Raw = Bas ? Bas.interpolateCdf(base.cdfPoints, tau) : { value: 0 };
    var p0 = clamp01(typeof p0Raw === 'object' ? safeNumber(p0Raw.value, 0) : safeNumber(p0Raw, 0));
    var mu = (o + 4 * m + p) / 6;
    var cv = (p - o) / Math.max(1e-9, mu);
    var sigma = stdDev(base.pdfPoints);
    var skew  = sigma > 0 ? (mu - tau) / sigma : 0;
    var range = Math.max(1e-9, p - o);

    return Object.assign({}, state, { baseline: base, p0: p0, cv: cv, sigma: sigma, skew: skew, range: range, currentProb: p0, o: o, m: m, p: p, tau: tau });
  }

  function step2_hypercubeLhs(state) {
    var adaptive = state.adaptive, skew = state.skew, p0 = state.p0;
    var probeLevel = safeProbeLevel(state.probeLevel);
    var dims = SLIDER_KEYS.length;
    var BENCH = [75, 75, 60, 50, 25, 50, 50];
    var dimBounds = PER_SLIDER_BOUNDS.map(function (b, i) {
      return { lo: b.lo, hi: Math.min(b.hi, BENCH[i] / 100) };
    });

    var samples;
    if (adaptive && probeLevel === 1) {
      var seedX = state.seedBest || new Array(dims).fill(0.5);
      samples = [seedX.slice()];
    } else {
      var nSamples = adaptive ? Math.max(100, 50 * probeLevel) : 250;
      samples = SACO_GEOMETRY.lhsSample(nSamples, dims, state.randomSeed);
      var bias = (adaptive && (state.cv > 0.5 || p0 < 0.3)) ? 0.15 : 0;
      bias += 0.2 * Math.sign(skew) * Math.min(0.3, 1 - p0);
      for (var j = 0; j < dims; j++) {
        var lo = dimBounds[j].lo, hi = dimBounds[j].hi, scale = hi - lo;
        for (var i = 0; i < samples.length; i++) {
          samples[i][j] = clamp01(lo + scale * samples[i][j] + bias * scale);
        }
      }
    }
    return Object.assign({}, state, { lhsSamples: samples });
  }

  function step3_warmStart(state) {
    var lhsSamples = state.lhsSamples, o = state.o, m = state.m, p = state.p, tau = state.tau;
    var baseline = state.baseline, p0 = state.p0, adaptive = state.adaptive, range = state.range, probeLevel = state.probeLevel;

    var trials = lhsSamples.slice(0, 50).map(function (s) {
      return [s[0], s[1], s[2], 0.5, 0.25, 0.5, 0.5];
    });
    var bestScore = -Infinity, bestGrid = trials[0] || new Array(7).fill(0.5), bestP = p0;
    for (var i = 0; i < trials.length; i++) {
      var e = sacoObjective(trials[i], o, m, p, tau, baseline.pdfPoints, baseline.cdfPoints, 0, adaptive, range, p0, probeLevel, state.seedBest);
      var sc = safeNumber(e.score, -1e12);
      if (sc > bestScore) { bestScore = sc; bestGrid = trials[i]; bestP = clamp01(e.pNew); }
    }
    return Object.assign({}, state, { bestGrid: bestGrid, bestScore: bestScore, bestP: bestP, currentProb: bestP });
  }

  function step4_search(state) {
    var lhsSamples = state.lhsSamples, o = state.o, m = state.m, p = state.p, tau = state.tau;
    var baseline = state.baseline, p0 = state.p0, adaptive = state.adaptive, range = state.range, probeLevel = state.probeLevel;

    var best = { score: -Infinity, x: new Array(7).fill(0.5), pNew: p0 };
    for (var i = 0; i < lhsSamples.length; i++) {
      var e = sacoObjective(lhsSamples[i], o, m, p, tau, baseline.pdfPoints, baseline.cdfPoints, 0, adaptive, range, p0, probeLevel, state.seedBest);
      if (e.score > best.score && e.feasible) {
        best = { score: e.score, x: lhsSamples[i].slice(), pNew: e.pNew };
      }
    }
    if (!Number.isFinite(best.score) || best.score <= -1e11 || best.pNew <= p0) {
      best = { score: -1e9 + 1, x: [0.65, 0.65, 0.6, 0.15, 0.25, 0.5, 0.5], pNew: p0 + 0.001, status: 'promote' };
    }
    return Object.assign({}, state, { bestGridFull: best.x, bestScoreFull: best.score, bestPFull: best.pNew, status: best.status || state.status });
  }

  function step5_refine(state) {
    var bestGridFull = state.bestGridFull, o = state.o, m = state.m, p = state.p, tau = state.tau;
    var baseline = state.baseline, adaptive = state.adaptive, range = state.range, p0 = state.p0, probeLevel = state.probeLevel;

    var objective = function (x01) {
      var res = sacoObjective(x01, o, m, p, tau, baseline.pdfPoints, baseline.cdfPoints, 0, adaptive, range, p0, probeLevel, state.seedBest);
      return { score: safeNumber(res.score, -1e12) };
    };
    var refOpts = (probeLevel === 1 && adaptive)
      ? { maxIter: 5, rhoInit: 0.15, rhoFinal: 0.15 }
      : { maxIter: adaptive ? 100 : 60 };

    var res = cobyla(objective, bestGridFull, o, m, p, tau, baseline.pdfPoints, baseline.cdfPoints, refOpts, adaptive, probeLevel, state.seedBest, p0);
    return Object.assign({}, state, { result: res, currentProb: state.currentProb });
  }

  function step6_robust(state) {
    return Object.assign({}, state, { robustStd: 0.05 });
  }

  function step7_output(state) {
    var Bas = B();
    var o = state.o, m = state.m, p = state.p, tau = state.tau;
    var baseline = state.baseline, p0 = state.p0, adaptive = state.adaptive, range = state.range, probeLevel = state.probeLevel;
    var stepStatus = state.status;

    var x = (state.result && state.result.x && state.result.x.length === 7) ? state.result.x.slice() : new Array(7).fill(0);
    var seedBest = state.seedBest || new Array(7).fill(0.5);

    if (x.every(function (v) { return v < 0.01; }) && stepStatus === 'promote') {
      x = [0.65, 0.65, 0.6, 0.15, 0.25, 0.5, 0.5];
    }

    /* Adaptive reversion: clamp sliders too far from seed */
    var reverted = false;
    if (adaptive) {
      for (var i = 0; i < 7; i++) {
        var div = Math.abs(x[i] - seedBest[i]) / Math.max(seedBest[i] || 0.01, 1e-6);
        if (div > 0.50) {
          x[i] = clamp01(seedBest[i] + 0.10 * (2 * Math.random() - 1));
          reverted = true;
        }
      }
    }

    x = applyReshapeRules(x, adaptive ? 'adaptive' : 'fixed', probeLevel, seedBest, state);

    var sliders = {};
    SLIDER_KEYS.forEach(function (k, i) { sliders[k] = x[i]; });

    var sliders100 = {};
    SLIDER_KEYS.forEach(function (k) {
      sliders100[k] = (k === 'reworkPercentage') ? sliders[k] * 50 : sliders[k] * 100;
    });

    var cv = (p - o) / ((o + 4 * m + p) / 6);
    var momentsObj = SACO_GEOMETRY.computeMoments(sliders100, 1, cv);
    var mArr = momentsObj.moments || [0, 0];

    var _oA7 = o * (1 - (sliders.budgetFlexibility || 0) * 0.25)       * (1 - (sliders.scopeReductionAllowance || 0) * 0.12);
    var _mA7 = m * (1 - (sliders.scheduleFlexibility || 0) * 0.12)     * (1 - (sliders.userConfidence || 0) * 0.08) * (1 + (sliders.reworkPercentage || 0) * 0.10);
    var _pA7 = p * (1 - (sliders.scopeCertainty || 0) * 0.20)          * (1 - (sliders.scopeReductionAllowance || 0) * 0.10) * (1 + (sliders.reworkPercentage || 0) * 0.08);
    var _oS7 = _oA7, _mS7 = Math.max(_oS7 * 1.001, _mA7), _pS7 = Math.max(_mS7 * 1.001, _pA7);

    var refit = SACO_GEOMETRY.betaRefit(_oS7, _mS7, _pS7, mArr);
    var reshapedPdf = baseline.pdfPoints;
    var reshapedCdf = baseline.cdfPoints;

    if (refit && Bas) {
      try {
        var betaPts = Bas.generateBetaPoints({
          optimistic: _oS7, mostLikely: _mS7, pessimistic: _pS7,
          numSamples: baseline.pdfPoints.length || 200,
          alpha: refit.alpha, beta: refit.beta
        });
        if (betaPts && betaPts.pdfPoints && betaPts.pdfPoints.length > 1) {
          reshapedPdf = betaPts.pdfPoints;
          reshapedCdf = betaPts.cdfPoints;
        }
      } catch (_) { /* fallback to baseline */ }
    }

    /* Safe final probability extraction */
    var finalProb = 0.5;
    if (Bas && Bas.interpolateCdf) {
      var rawFP = Bas.interpolateCdf(reshapedCdf, tau);
      if (rawFP !== null && rawFP !== undefined) {
        if (typeof rawFP === 'object' && Number.isFinite(rawFP.value)) {
          finalProb = clamp01(rawFP.value);
        } else if (Number.isFinite(rawFP)) {
          finalProb = clamp01(rawFP);
        }
      }
      if (!Number.isFinite(finalProb) || finalProb === 0) {
        var fb = Bas.interpolateCdf(baseline.cdfPoints, tau);
        finalProb = clamp01(typeof fb === 'object' ? safeNumber(fb.value, 0.5) : safeNumber(fb, 0.5));
      }
    }

    var lift = finalProb - p0;

    /* Guard: never return worse than baseline */
    if (Number.isFinite(lift) && lift < -0.0001 && Number.isFinite(p0)) {
      finalProb = p0; lift = 0;
      reshapedPdf = baseline.pdfPoints;
      reshapedCdf = baseline.cdfPoints;
      SLIDER_KEYS.forEach(function (k, i) { x[i] = 0; sliders[k] = 0; sliders100[k] = 0; });
      reverted = true;
    }

    var kl = 0;
    try {
      var basePdfN = baseline.pdfPoints.map(function (pt) { return { x: (pt.x - o) / range, y: pt.y * range }; });
      var newPdfN  = reshapedPdf.map(function (pt)         { return { x: (pt.x - o) / range, y: pt.y * range }; });
      var klObj = SACO_GEOMETRY.klDivergence({ distributions: { triangle: { pdfPoints: newPdfN }, monteCarloSmoothed: { pdfPoints: basePdfN } }, task: 'opt' });
      kl = safeNumber(klObj['triangle-monteCarloSmoothed'], 0);
    } catch (_) {}

    var liftSafe = Number.isFinite(lift) ? lift : 0;
    var chainingDrift = null;
    if (seedBest && adaptive) {
      var totalDev = 0;
      var seedArr = Array.isArray(seedBest) ? seedBest : Object.values(seedBest);
      SLIDER_KEYS.forEach(function (k, i) { totalDev += Math.abs(sliders[k] - (seedArr[i] || 0)); });
      var avgSeed = arrMean(seedArr.map(function (v) { return Number(v) || 0; }));
      chainingDrift = avgSeed > 0 ? (totalDev / 7 / avgSeed * 100) : null;
    }

    var explain = {
      klDivergence: kl,
      narrative: (liftSafe > 0.0001
        ? 'Lift ' + (liftSafe * 100).toFixed(2) + ' pts'
        : 'Baseline is already optimal') +
        '; ' + (adaptive ? 'adaptive' : 'fixed') + '; probe=' + probeLevel +
        (reverted ? ' (reverted to baseline — no improvement found)' : ''),
      mode: adaptive ? 'adaptive' : 'fixed',
      probeLevel: probeLevel,
      baselineProb: p0,
      finalProb: finalProb,
      winningSliders: Object.assign({}, sliders),
      chainingDrift: chainingDrift
    };

    var status = (liftSafe >= 0.0001 || stepStatus === 'promote') ? 'ok' : 'no-optimize';
    return {
      sliders: sliders,
      scaledSliders: Object.assign({}, sliders),
      reshapedPoints: { pdfPoints: reshapedPdf, cdfPoints: reshapedCdf },
      explain: explain,
      finalProb: finalProb,
      status: status
    };
  }

  /* ------------------------------------------------------------------ */
  /* Orchestrator — two-stage SACO                                       */
  /* ------------------------------------------------------------------ */

  /**
   * Run full SACO optimization.
   *
   * @param {object} params
   * @param {object} params.points          Pre-computed baseline { pdfPoints, cdfPoints }
   * @param {number} params.optimistic
   * @param {number} params.mostLikely
   * @param {number} params.pessimistic
   * @param {number} params.targetValue     τ
   * @param {boolean} [params.adaptive]     Run adaptive stage after fixed
   * @param {number} [params.probeLevel=5]  1–7; depth of adaptive search
   * @param {object} [params.manualSliders] If set, bypass optimizer and evaluate manually
   * @param {number} [params.randomSeed]    RNG seed for LHS
   * @returns {object} { sliders, reshapedPoints, explain, finalProb, status }
   */
  function optimizeSliders(params) {
    var Bas = B(), Cop = C();
    var o = params.optimistic, m = params.mostLikely, p = params.pessimistic, tau = params.targetValue;
    var adaptive   = !!params.adaptive;
    var probeLevel = safeProbeLevel(params.probeLevel !== undefined ? params.probeLevel : 5);
    var randomSeed = params.randomSeed !== undefined ? params.randomSeed : Date.now();

    /* Manual slider short-circuit */
    if (params.manualSliders && Object.keys(params.manualSliders).length) {
      try {
        var manualResult = (Cop && Cop.computeSliderProbability)
          ? Cop.computeSliderProbability({
              points: params.points, optimistic: o, mostLikely: m, pessimistic: p,
              targetValue: tau, sliderValues: params.manualSliders, probeLevel: 0
            })
          : null;
        if (manualResult) {
          return {
            sliders: manualResult.explain && manualResult.explain.manualSliders ? manualResult.explain.manualSliders : {},
            scaledSliders: manualResult.explain && manualResult.explain.manualSliders ? manualResult.explain.manualSliders : {},
            reshapedPoints: manualResult.reshapedPoints || { pdfPoints: [], cdfPoints: [] },
            explain: manualResult.explain || { narrative: 'Manual sliders processed.', mode: 'manual', probeLevel: 0 },
            finalProb: manualResult.probability ? manualResult.probability.value : null,
            status: 'manual'
          };
        }
      } catch (e) {
        /* fall through to optimizer */
      }
    }

    var pmDefaults = { budgetFlexibility: 0.65, scheduleFlexibility: 0.65, scopeCertainty: 0.6,
                       scopeReductionAllowance: 0.15, reworkPercentage: 0.25, riskTolerance: 0.5, userConfidence: 0.5 };

    var state = Object.assign({}, params, {
      o: o, m: m, p: p, tau: tau, randomSeed: randomSeed,
      adaptive: false, probeLevel: probeLevel,
      numSamples: (params.points && params.points.pdfPoints) ? params.points.pdfPoints.length : 200
    });

    try {
      if (![o, m, p, tau].every(Number.isFinite)) throw new Error('Invalid inputs');
      if (!(o < m && m < p)) throw new Error('Invalid triangular: need O < M < P');

      state = step1_baseline(state);

      /* Stage 1 — Fixed grid (always runs) */
      var fixedState = Object.assign({}, state, { adaptive: false, probeLevel: 1 });
      fixedState = step2_hypercubeLhs(fixedState);
      fixedState = step3_warmStart(fixedState);
      fixedState = step4_search(fixedState);
      fixedState = step5_refine(fixedState);
      fixedState = step6_robust(fixedState);
      var fixedOut = step7_output(fixedState);

      if (!adaptive) return fixedOut;

      /* Stage 2 — Adaptive (seeded from fixed) */
      var seedVec = (fixedState.result && fixedState.result.x && fixedState.result.x.length === 7)
        ? fixedState.result.x.slice()
        : (fixedState.bestGridFull || [0.75, 0.75, 0.6, 0.5, 0.25, 0.5, 0.5]);

      var adaptState = Object.assign({}, state, { adaptive: true, probeLevel: probeLevel, seedBest: seedVec });
      adaptState = step2_hypercubeLhs(adaptState);
      adaptState.bestGridFull = seedVec;
      adaptState.bestScoreFull = fixedState.bestScoreFull || -Infinity;
      adaptState = step3_warmStart(adaptState);
      adaptState = step4_search(adaptState);
      adaptState = step5_refine(adaptState);
      adaptState = step6_robust(adaptState);
      return step7_output(adaptState);

    } catch (error) {
      return {
        sliders: pmDefaults, scaledSliders: pmDefaults,
        reshapedPoints: { pdfPoints: (params.points && params.points.pdfPoints) || [], cdfPoints: (params.points && params.points.cdfPoints) || [] },
        explain: { narrative: 'Fallback: ' + (error.message || error), mode: adaptive ? 'adaptive' : 'fixed', probeLevel: probeLevel },
        finalProb: 0.5, status: 'no-optimize', error: error.message || String(error)
      };
    }
  }

  /* ------------------------------------------------------------------ */
  /* Public API                                                           */
  /* ------------------------------------------------------------------ */

  var PMCOptimizer = {
    /* Constants */
    SLIDER_KEYS:         SLIDER_KEYS,
    W_MEAN:              W_MEAN,
    PER_SLIDER_BOUNDS:   PER_SLIDER_BOUNDS,

    /* Primitives */
    lhsSample:           lhsSample,
    clamp01:             clamp01,
    erf:                 erf,
    stdDev:              stdDev,

    /* Core engine */
    sacoObjective:       sacoObjective,
    cobyla:              cobyla,
    optimizeSliders:     optimizeSliders,

    /* Exposed for testing */
    monotoneFeas:        monotoneFeas,
    boxClamp:            boxClamp
  };

  root.PMCOptimizer = PMCOptimizer;

})(typeof window !== 'undefined' ? window : this);
