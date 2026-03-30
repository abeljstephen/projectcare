/**
 * ProjectCare — Copula + Reshaping Engine
 * Ported from GAS:
 *   core/optimization/matrix-utils.gs
 *   core/optimization/kl-divergence.gs
 *   core/reshaping/copula-utils.gs
 *   core/reshaping/slider-adjustments.gs
 *
 * Exposes: window.PMCCopula
 * Depends on: window.PMCBaseline (must be loaded first)
 * All pure math — no DOM, no network.
 */

(function (root) {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Local helpers (shadow PMCBaseline helpers for internal use)         */
  /* ------------------------------------------------------------------ */
  function clamp01(x) { return Math.max(0, Math.min(1, Number(x) || 0)); }
  function to01(x) { var v = Number(x); return Number.isFinite(v) ? clamp01(v / 100) : 0; }
  function dot(a, b) { var s = 0; for (var i = 0; i < a.length; i++) s += (a[i] || 0) * (b[i] || 0); return s; }
  function arrMean(a) { if (!a.length) return 0; return a.reduce(function (s, v) { return s + v; }, 0) / a.length; }
  function arrStdev(a) {
    var m = arrMean(a);
    var v = arrMean(a.map(function (x) { return (x - m) * (x - m); }));
    return Math.sqrt(Math.max(0, v));
  }

  /* ------------------------------------------------------------------ */
  /* Standard normal helpers (Phi / probit)                              */
  /* ------------------------------------------------------------------ */

  /**
   * Standard normal CDF — Abramowitz & Stegun 26.2.17 (max error 7.5e-8).
   */
  function phi(x) {
    var t = 1 / (1 + 0.2315419 * Math.abs(x));
    var poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    var pdf = Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
    var cdf = 1 - pdf * poly;
    return x >= 0 ? cdf : 1 - cdf;
  }

  /**
   * Inverse standard normal CDF — rational approximation (Beasley-Springer-Moro).
   */
  function probit(p) {
    if (p <= 0) return -Infinity;
    if (p >= 1) return Infinity;
    var a = [0, -3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
               1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    var b = [0, -5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
               6.680131188771972e+01, -1.328068155288572e+01];
    var c = [0, -7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
               -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    var d = [0, 7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
    var pLow = 0.02425, pHigh = 1 - pLow;
    var q, r;
    if (p < pLow) {
      q = Math.sqrt(-2 * Math.log(p));
      return (((((c[1]*q+c[2])*q+c[3])*q+c[4])*q+c[5])*q+c[6]) / ((((d[1]*q+d[2])*q+d[3])*q+d[4])*q+1);
    } else if (p <= pHigh) {
      q = p - 0.5; r = q * q;
      return (((((a[1]*r+a[2])*r+a[3])*r+a[4])*r+a[5])*r+a[6])*q / (((((b[1]*r+b[2])*r+b[3])*r+b[4])*r+b[5])*r+1);
    } else {
      q = Math.sqrt(-2 * Math.log(1 - p));
      return -(((((c[1]*q+c[2])*q+c[3])*q+c[4])*q+c[5])*q+c[6]) / ((((d[1]*q+d[2])*q+d[3])*q+d[4])*q+1);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Constants                                                           */
  /* ------------------------------------------------------------------ */

  var SLIDER_KEYS = [
    'budgetFlexibility',
    'scheduleFlexibility',
    'scopeCertainty',
    'scopeReductionAllowance',
    'reworkPercentage',
    'riskTolerance',
    'userConfidence'
  ];

  /* PMBOK Chapter 6 correlation matrix (7×7, positive semi-definite + jitter) */
  var BASE_R = [
    /*               BUD    SCH    SC     SRA    RWK    RISK   CONF  */
    /* BUD */  [ 1.00, 0.40, 0.10, 0.05, 0.00,-0.05, 0.05 ],
    /* SCH */  [ 0.40, 1.00, 0.10, 0.05, 0.00,-0.05, 0.05 ],
    /* SC  */  [ 0.10, 0.10, 1.00, 0.35,-0.10, 0.00, 0.00 ],
    /* SRA */  [ 0.05, 0.05, 0.35, 1.00,-0.05, 0.00, 0.00 ],
    /* RWK */  [ 0.00, 0.00,-0.10,-0.05, 1.00,-0.10,-0.10 ],
    /* RISK*/  [-0.05,-0.05, 0.00, 0.00,-0.10, 1.00, 0.25 ],
    /* CONF*/  [ 0.05, 0.05, 0.00, 0.00,-0.10, 0.25, 1.00 ]
  ];

  var W_MEAN = [-0.2, 0.1, 0.3, -0.15, -0.08, 0.25, 0.05];
  var W_VAR  = [ 0.1, 0.1, 0.2,  0.15,  0.08,  0.5, 0.05];
  var DIAG_W = [ 0.2, 0.2, 0.15, 0.15,  0.1,  0.25, 0.1 ];

  var SLIDER_CATEGORIES = {
    budgetFlexibility:       'capacity',
    scheduleFlexibility:     'capacity',
    scopeCertainty:          'certainty',
    scopeReductionAllowance: 'process',
    reworkPercentage:        'process',
    riskTolerance:           'behavioral',
    userConfidence:          'other'
  };

  /* ------------------------------------------------------------------ */
  /* Matrix utilities (ported from matrix-utils.gs)                     */
  /* ------------------------------------------------------------------ */

  function psdJitter(R, eps) {
    eps = eps === undefined ? 1e-3 : eps;
    var out = R.map(function (row) { return row.slice(); });
    for (var i = 0; i < out.length; i++) {
      out[i][i] = Math.min(1, Math.max(0.0, out[i][i] + eps));
    }
    return out;
  }

  function trapezoidArea(points) {
    var A = 0;
    for (var i = 1; i < points.length; i++) {
      A += 0.5 * (points[i - 1].y + points[i].y) * (points[i].x - points[i - 1].x);
    }
    return A;
  }

  function renormalizePdf(points) {
    var A = trapezoidArea(points);
    if (!Number.isFinite(A) || A <= 0) return false;
    for (var i = 0; i < points.length; i++) points[i].y /= A;
    return true;
  }

  /**
   * Align two PDF arrays onto a common x-grid using linear interpolation.
   * Both output arrays share the same x values and are renormalized.
   */
  function alignPoints(p, q) {
    var B = root.PMCBaseline;
    if (!Array.isArray(p) || !Array.isArray(q) || p.length < 2 || q.length < 2) {
      return [p || [], q || []];
    }
    if (B && B.isValidPdfArray) {
      if (!B.isValidPdfArray(p) || !B.isValidPdfArray(q)) return [p, q];
    }
    var xMin = Math.min(p[0].x, q[0].x);
    var xMax = Math.max(p[p.length - 1].x, q[q.length - 1].x);
    var dp = p.length > 1 ? (p[1].x - p[0].x) : NaN;
    var dq = q.length > 1 ? (q[1].x - q[0].x) : NaN;
    var candidates = [dp, dq].filter(function (v) { return Number.isFinite(v) && v > 0; });
    var step = candidates.length ? Math.min.apply(null, candidates) / 2 : NaN;
    if (!Number.isFinite(step) || step <= 0) {
      step = Math.max(1e-9, xMax - xMin) / Math.max(2, Math.max(p.length, q.length) - 1);
    }
    var n = Math.max(2, Math.ceil((xMax - xMin) / step) + 1);
    var xs = [];
    for (var k = 0; k < n; k++) xs.push(xMin + k * step);

    function lerpSeg(A, x) {
      if (x <= A[0].x) return A[0].y;
      if (x >= A[A.length - 1].x) return A[A.length - 1].y;
      for (var i = 0; i < A.length - 1; i++) {
        if (A[i].x <= x && x <= A[i + 1].x) {
          var d = (A[i + 1].x - A[i].x) || 1;
          var t = (x - A[i].x) / d;
          return A[i].y + t * (A[i + 1].y - A[i].y);
        }
      }
      return 0;
    }

    var P = xs.map(function (x) { return { x: x, y: lerpSeg(p, x) }; });
    var Q = xs.map(function (x) { return { x: x, y: lerpSeg(q, x) }; });
    renormalizePdf(P);
    renormalizePdf(Q);
    return [P, Q];
  }

  function validateDistributionInputs(distributions) {
    var B = root.PMCBaseline;
    if (!distributions || Object.keys(distributions).length === 0) {
      throw new Error('Invalid distributions');
    }
    var keys = Object.keys(distributions);
    for (var i = 0; i < keys.length; i++) {
      var pts = distributions[keys[i]];
      var ok = B ? B.isValidPdfArray(pts) : (Array.isArray(pts) && pts.length >= 2);
      if (!ok) throw new Error('Invalid points for distribution: ' + keys[i]);
    }
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* KL Divergence (ported from kl-divergence.gs)                       */
  /* ------------------------------------------------------------------ */

  /**
   * Compute KL divergence D_KL(P || Q) between two PDFs using trapezoidal integration.
   * Both PDFs are first aligned onto a common grid.
   * Returns { 'triangle-monteCarloSmoothed': number }
   */
  function computeKLDivergence(params) {
    try {
      var distributions = params.distributions;
      if (!distributions || !distributions.triangle || !distributions.monteCarloSmoothed) {
        return { 'triangle-monteCarloSmoothed': 0 };
      }
      var pPts = distributions.triangle.pdfPoints;
      var qPts = distributions.monteCarloSmoothed.pdfPoints;
      if (!Array.isArray(pPts) || pPts.length < 2 || !Array.isArray(qPts) || qPts.length < 2) {
        return { 'triangle-monteCarloSmoothed': 0 };
      }

      var aligned = alignPoints(pPts.map(function (p) { return { x: p.x, y: p.y }; }),
                                qPts.map(function (p) { return { x: p.x, y: p.y }; }));
      var P = aligned[0], Q = aligned[1];
      renormalizePdf(P);
      renormalizePdf(Q);

      var EPS = 1e-12;
      var kl = 0;
      for (var i = 1; i < P.length; i++) {
        var dx = P[i].x - P[i - 1].x;
        if (!Number.isFinite(dx) || dx <= 0) continue;
        var p0 = Math.max(P[i - 1].y, EPS), p1 = Math.max(P[i].y, EPS);
        var q0 = Math.max(Q[i - 1].y, EPS), q1 = Math.max(Q[i].y, EPS);
        var f0 = p0 * Math.log(p0 / q0);
        var f1 = p1 * Math.log(p1 / q1);
        kl += 0.5 * (f0 + f1) * dx;
      }
      if (!Number.isFinite(kl)) kl = 0;
      kl = Math.max(0, kl);
      return { 'triangle-monteCarloSmoothed': kl };
    } catch (e) {
      return { 'triangle-monteCarloSmoothed': 0 };
    }
  }

  /* ------------------------------------------------------------------ */
  /* Gaussian copula (ported from copula-utils.gs)                      */
  /* ------------------------------------------------------------------ */

  /**
   * Correlation-weighted coupling signal (Patent Claim 2).
   * Not a probit→Cholesky→Φ copula. Intentional design: z-scores → R·z → tanh sigmoid → U ∈ (0,1)^7.
   * mean(U) = coupling scalar; t = clamp(0.3 + 0.4 × coupling) drives the linear/OR blend weight.
   */
  function computeCouplingSignal(S01) {
    var n = SLIDER_KEYS.length;
    var R = psdJitter(BASE_R, 1e-6);
    var m = arrMean(S01);
    var sd = Math.max(1e-6, arrStdev(S01));
    var z = S01.map(function (s) { return (s - m) / sd; });
    var zc = new Array(n).fill(0);
    for (var i = 0; i < n; i++) {
      var acc = 0;
      for (var j = 0; j < n; j++) acc += R[i][j] * z[j];
      zc[i] = acc;
    }
    return zc.map(function (v) { return clamp01(0.5 + 0.2 * Math.tanh(v)); });
  }

  /**
   * Compute adjusted moments [m0, m1, 0, 0] from slider values in 0–100 units.
   * Hybrid: linear weighted + prob-OR + Gaussian copula + thesis W_MEAN/W_VAR.
   *
   * @param {Object} sliders100  { key: 0-100 }
   * @param {number} [scaleFactor=1]  Fixed at 1 per SACO patch v1.2
   * @param {number} [cv=0]  Coefficient of variation for variance amplification
   */
  function computeAdjustedMoments(sliders100, scaleFactor, cv) {
    scaleFactor = scaleFactor === undefined ? 1 : scaleFactor;
    cv = cv === undefined ? 0 : cv;
    try {
      var n = SLIDER_KEYS.length;
      var vals = SLIDER_KEYS.map(function (key, i) {
        if (sliders100[key] !== undefined) return sliders100[key];
        return Array.isArray(sliders100) ? (sliders100[i] || 0) : 0;
      });
      var raw01 = vals.map(to01);
      var sumRaw = raw01.reduce(function (s, v) { return s + v; }, 0);
      var allZeroRaw = sumRaw < 1e-9;
      var S01 = raw01.slice();
      /* Invert rework (higher rework = worse, so invert for "goodness") */
      S01[4] = Math.max(0, Math.min(1, 1 - S01[4]));

      var W = [0.20, 0.20, 0.18, 0.15, 0.10, 0.09, 0.08]; // sums to 1.0
      var lin = Math.max(0, Math.min(1, dot(W, S01)));

      /* Prob-OR diminishing returns */
      var por = 0;
      for (var i = 0; i < n; i++) por = 1 - (1 - por) * (1 - 0.9 * S01[i]);
      por = Math.max(0, Math.min(1, por));

      /* Blend linear & prob-OR via copula coupling */
      var U = computeCouplingSignal(S01);
      var coupling = arrMean(U);
      var t = Math.max(0, Math.min(1, 0.3 + 0.4 * coupling));
      var m0 = allZeroRaw ? 0 : Math.max(0, Math.min(1, (1 - t) * lin + t * por));

      /* m1: variance proxy */
      var m1Base = Math.max(0, Math.min(1, 0.8 - 0.5 * lin));
      var m1 = Math.max(0, m1Base * (1 + cv / 2));

      /* Thesis moments via W_MEAN/W_VAR/DIAG_W */
      var m0_thesis = 0, m1_thesis = 0;
      for (var j = 0; j < 7; j++) {
        m0_thesis += S01[j] * W_MEAN[j] * DIAG_W[j];
        m1_thesis += S01[j] * W_VAR[j]  * DIAG_W[j];
      }
      m0_thesis *= scaleFactor;
      m1_thesis *= scaleFactor * (1 + cv / 2);
      m0_thesis = Math.max(-0.8, Math.min(0.8, m0_thesis));
      m1_thesis = Math.max(0, Math.min(1.5, m1_thesis));

      /* Per-slider breakdown */
      var momentsBreakdown = {};
      SLIDER_KEYS.forEach(function (key, idx) {
        var w = W[idx], s = S01[idx];
        momentsBreakdown[key] = [
          m0 > 0 ? (w * s) / (m0 || 1) : 0,
          m1 > 0 ? (w * s * (1 + cv / 2)) / (m1 || 1) : 0
        ];
      });

      /* Hybrid blend (0.5 / 0.5 as per SACO v1.2) */
      var hybrid_m0 = 0.5 * m0 + 0.5 * m0_thesis;
      var hybrid_m1 = 0.5 * m1 + 0.5 * m1_thesis;

      return {
        moments: [hybrid_m0, hybrid_m1, 0, 0],
        explain: {
          sliders01: S01,
          linearMean: lin,
          probOR: por,
          blendT: t,
          scaleFactor: scaleFactor,
          cvAmp: cv,
          momentsBreakdown: momentsBreakdown,
          thesisMoments: { m0: m0_thesis, m1: m1_thesis },
          hybridBlend: 0.5
        }
      };
    } catch (err) {
      return { moments: [0, 0, 0, 0], explain: { m0: 0, m1: 0, error: err.message } };
    }
  }

  /* ------------------------------------------------------------------ */
  /* Beta refit (ported from slider-adjustments.gs)                     */
  /* ------------------------------------------------------------------ */

  /**
   * Map moments [m0, m1] → Beta(α,β) parameters on [optimistic, pessimistic].
   * m0: mean-shift factor (0..1)
   * m1: variance-shrink factor (0..1)
   * Returns { alpha, beta } or null if degenerate.
   */
  function betaRefit(optimistic, mostLikely, pessimistic, m0, m1) {
    var o = optimistic, m = mostLikely, p = pessimistic;
    var mu0  = (o + 4 * m + p) / 6;
    var var0 = Math.pow((p - o) / 6, 2);
    var range = Math.max(1e-9, p - o);

    var mu1 = mu0 * (1 - clamp01(m0) * 0.2);
    mu1 = Math.max(o * 1.01, mu1);

    var var1 = Math.max(1e-12, Math.min(var0, var0 * (1 - clamp01(m1) * 0.5)));

    var mu01  = clamp01((mu1 - o) / range);
    var var01 = Math.max(1e-12, var1 / (range * range));

    var denom = mu01 * (1 - mu01) / var01 - 1;
    var alpha = mu01 * denom;
    var beta  = (1 - mu01) * denom;

    if (!(alpha > 0 && beta > 0 && Number.isFinite(alpha) && Number.isFinite(beta))) return null;
    return { alpha: alpha, beta: beta };
  }

  /* ------------------------------------------------------------------ */
  /* Band / rules helpers                                                */
  /* ------------------------------------------------------------------ */

  function bandOf(v) {
    var x = Number(v) || 0;
    if (x === 0) return 'Zero';
    if (x <= 25) return 'Low';
    if (x <= 50) return 'Moderate';
    if (x <= 75) return 'High';
    return 'Very High';
  }

  /** Lightweight rules engine: counter-intuition flags + recommendations. */
  function rulesEngine(sliders, baselineProb, finalProb, targetValue) {
    var s = sliders;
    var ci = [], recs = [];

    function pctStr(x) { return x == null ? '–' : (100 * x).toFixed(2) + '%'; }

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
        because: 'Perception (' + s.userConfidence + '%) is outpacing modeled likelihood (' + pctStr(baselineProb) + ').',
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

  /* ------------------------------------------------------------------ */
  /* CDF lift fallback (used when beta refit yields invalid params)      */
  /* ------------------------------------------------------------------ */

  function cdfLiftFallback(baseCdf, normalized01, tau) {
    var w = {
      budgetFlexibility: 0.20, scheduleFlexibility: 0.20, scopeCertainty: 0.20,
      scopeReductionAllowance: 0.15, reworkPercentage: -0.15,
      riskTolerance: 0.07, userConfidence: 0.03
    };
    var raw = Object.keys(normalized01).reduce(function (sum, key) {
      return sum + (w[key] || 0) * (normalized01[key] || 0);
    }, 0);
    var maxDelta = 0.25;
    var gain = Math.max(-maxDelta, Math.min(maxDelta, raw)) * 0.25;
    var sorted = baseCdf.slice().sort(function (a, b) { return a.x - b.x; });
    var newCdf = sorted.map(function (p) {
      var F = clamp01(Number(p.y));
      return { x: Number(p.x), y: clamp01(F + gain * (1 - F)) };
    });

    /* Derive PDF from CDF */
    var newPdf = [{ x: newCdf[0].x, y: 0 }];
    for (var i = 1; i < newCdf.length; i++) {
      var dx = Math.max(1e-12, newCdf[i].x - newCdf[i - 1].x);
      var dy = clamp01(newCdf[i].y) - clamp01(newCdf[i - 1].y);
      var midX = newCdf[i - 1].x + dx / 2;
      newPdf.push({ x: midX, y: Math.max(0, dy / dx) });
    }
    newPdf.push({ x: newCdf[newCdf.length - 1].x, y: 0 });

    var B = root.PMCBaseline;
    var finalProb = null;
    if (Number.isFinite(tau) && B && B.interpolateCdf) {
      finalProb = clamp01(B.interpolateCdf(newCdf, tau).value);
    }
    return { newCdf: newCdf, newPdf: newPdf, finalProb: finalProb };
  }

  /* ------------------------------------------------------------------ */
  /* computeSliderProbability (ported from slider-adjustments.gs)       */
  /* ------------------------------------------------------------------ */

  /**
   * Compute slider-adjusted probability and reshaped distribution.
   *
   * probeLevel === 0  → manual mode (user sliders, no SACO search; guardrails applied)
   * probeLevel > 0    → SACO-style reshaping (moments → beta refit, richer explain)
   *
   * Requires window.PMCBaseline for: interpolateCdf, generateBetaPoints,
   *   isValidPdfArray, isValidCdfArray.
   */
  function computeSliderProbability(args) {
    var B = root.PMCBaseline;
    var points      = args.points      || {};
    var optimistic  = args.optimistic;
    var mostLikely  = args.mostLikely;
    var pessimistic = args.pessimistic;
    var targetValue = args.targetValue;
    var sliderValues = args.sliderValues || {};
    var probeLevel  = args.probeLevel !== undefined ? args.probeLevel : 0;

    function asPointsArray(maybe) {
      if (Array.isArray(maybe)) return maybe;
      if (maybe && Array.isArray(maybe.value)) return maybe.value;
      return [];
    }

    var basePdf = asPointsArray(points.pdfPoints);
    var baseCdf = asPointsArray(points.cdfPoints);

    var isValidPdf = B ? B.isValidPdfArray : function (a) { return Array.isArray(a) && a.length >= 2; };
    var isValidCdf = B ? B.isValidCdfArray : function (a) { return Array.isArray(a) && a.length >= 2; };
    var interpCdf  = B ? B.interpolateCdf  : function () { return { value: 0.5 }; };
    var genBeta    = B ? B.generateBetaPoints : function () { return { pdfPoints: [], cdfPoints: [] }; };

    if (!isValidCdf(baseCdf) || !isValidPdf(basePdf)) {
      return {
        probability: { value: null },
        reshapedPoints: { pdfPoints: basePdf, cdfPoints: baseCdf },
        explain: {
          baselineProb: null, finalProb: null,
          monotonicityAtTarget: 'Unknown', allZeroSlidersPassThrough: 'Unknown',
          narrative: 'Missing or invalid input points; returned pass-through.',
          projection: { used: false }
        }
      };
    }

    var tau = Number.isFinite(targetValue) ? Number(targetValue) : mostLikely;
    var baseProb = Number.isFinite(tau) ? clamp01(interpCdf(baseCdf, tau).value) : null;

    /* Default slider values */
    var sv = Object.assign({
      budgetFlexibility: 0, scheduleFlexibility: 0, scopeCertainty: 0,
      scopeReductionAllowance: 0, reworkPercentage: 0,
      riskTolerance: 0, userConfidence: 100
    }, sliderValues);

    /* Check all "effectiveness" sliders are zero (userConfidence doesn't count) */
    var allZero = ['budgetFlexibility','scheduleFlexibility','scopeCertainty',
                   'scopeReductionAllowance','reworkPercentage','riskTolerance']
      .every(function (k) { return Math.abs(Number(sv[k])) < 1e-6; });

    if (allZero) {
      return {
        probability: { value: baseProb },
        reshapedPoints: { pdfPoints: basePdf, cdfPoints: baseCdf },
        explain: {
          baselineProb: baseProb, finalProb: baseProb,
          monotonicityAtTarget: 'Yes', allZeroSlidersPassThrough: 'Yes',
          narrative: 'All sliders are zero; baseline distribution returned unchanged.',
          projection: { used: false },
          sliders: [], sliderCategories: {}, bands: {},
          winningSliders: {
            budgetFlexibility: 0, scheduleFlexibility: 0, scopeCertainty: 0,
            scopeReductionAllowance: 0, reworkPercentage: 0,
            riskTolerance: 0, userConfidence: 100
          }
        }
      };
    }

    var origMean = (optimistic + 4 * mostLikely + pessimistic) / 6;
    var range    = pessimistic - optimistic;
    var cv       = range / Math.max(origMean, 1e-9);

    var normalized01 = {
      budgetFlexibility:       clamp01((sv.budgetFlexibility || 0) / 100),
      scheduleFlexibility:     clamp01((sv.scheduleFlexibility || 0) / 100),
      scopeCertainty:          clamp01((sv.scopeCertainty || 0) / 100),
      scopeReductionAllowance: clamp01((sv.scopeReductionAllowance || 0) / 100),
      reworkPercentage:        clamp01((sv.reworkPercentage || 0) / 50),
      riskTolerance:           clamp01((sv.riskTolerance || 0) / 100),
      userConfidence:          clamp01(((sv.userConfidence != null ? sv.userConfidence : 100)) / 100)
    };

    var sliders100 = {
      budgetFlexibility: sv.budgetFlexibility || 0,
      scheduleFlexibility: sv.scheduleFlexibility || 0,
      scopeCertainty: sv.scopeCertainty || 0,
      scopeReductionAllowance: sv.scopeReductionAllowance || 0,
      reworkPercentage: sv.reworkPercentage || 0,
      riskTolerance: sv.riskTolerance || 0,
      userConfidence: sv.userConfidence != null ? sv.userConfidence : 100
    };

    var finalProb = baseProb;
    var newCdf = baseCdf.slice();
    var newPdf = basePdf.slice();
    var explain = null;

    /* ---------- Manual path (probeLevel === 0) ---------- */
    if (probeLevel === 0) {
      var momentsObj;
      try { momentsObj = computeAdjustedMoments(sliders100, 1, cv); }
      catch (e) { momentsObj = { moments: [0, 0], explain: { error: e.message } }; }

      var moments0 = Array.isArray(momentsObj.moments) ? momentsObj.moments : [0, 0];
      var refit = betaRefit(optimistic, mostLikely, pessimistic, moments0[0], moments0[1]);
      var kl = 0, projectionUsed = false, usedBeta = false;

      if (refit) {
        try {
          var betaPts = genBeta({
            optimistic: optimistic, mostLikely: mostLikely, pessimistic: pessimistic,
            numSamples: baseCdf.length || 200,
            alpha: refit.alpha, beta: refit.beta
          });
          if (isValidPdf(betaPts.pdfPoints) && isValidCdf(betaPts.cdfPoints)) {
            newPdf = betaPts.pdfPoints;
            newCdf = betaPts.cdfPoints;
            usedBeta = true;
            if (Number.isFinite(tau)) finalProb = clamp01(interpCdf(newCdf, tau).value);

            var safeRange = Math.max(1e-9, range);
            var basePdfN = basePdf.map(function (pt) { return { x: (pt.x - optimistic) / safeRange, y: pt.y * safeRange }; });
            var newPdfN  = newPdf.map(function (pt)  { return { x: (pt.x - optimistic) / safeRange, y: pt.y * safeRange }; });
            try {
              var klObj = computeKLDivergence({ distributions: { triangle: { pdfPoints: newPdfN }, monteCarloSmoothed: { pdfPoints: basePdfN } }, task: 'manual-refit' });
              kl = Number(klObj['triangle-monteCarloSmoothed'] || 0);
            } catch (_) { kl = 0; }
          }
        } catch (_) { usedBeta = false; }
      }

      if (!usedBeta || !isValidPdf(newPdf) || !isValidCdf(newCdf)) {
        var fb = cdfLiftFallback(baseCdf, normalized01, tau);
        newCdf = fb.newCdf; newPdf = fb.newPdf;
        if (fb.finalProb !== null) finalProb = fb.finalProb;
        kl = 0;
      }

      /* Guardrail: never allow manual sliders to produce a worse result */
      if (Number.isFinite(finalProb) && Number.isFinite(baseProb) && finalProb < baseProb) {
        projectionUsed = true;
        finalProb = baseProb;
        newPdf = basePdf.slice();
        newCdf = baseCdf.slice();
      }

      var liftPts = (Number.isFinite(finalProb) && Number.isFinite(baseProb)) ? (finalProb - baseProb) * 100 : 0;
      var bands = {}, cats = {}, winning = {};
      Object.keys(SLIDER_CATEGORIES).forEach(function (k) {
        var vRaw = Number(sv[k] || 0);
        bands[k] = bandOf(vRaw);
        cats[k] = SLIDER_CATEGORIES[k];
        if (vRaw >= 50) winning[k] = vRaw;
      });

      explain = {
        baselineProb: baseProb, finalProb: finalProb,
        monotonicityAtTarget: 'Yes', allZeroSlidersPassThrough: 'No',
        sliderCategories: cats, bands: bands, winningSliders: winning,
        projection: { used: projectionUsed, guard: 'baseline-or-better' },
        narrative: 'Manual mode: user sliders applied with shape-aware beta refit; ΔF(τ) = ' +
          (liftPts >= 0 ? '+' : '') + liftPts.toFixed(2) + ' points at τ=' +
          (Number.isFinite(tau) ? tau.toFixed(3) : '–') +
          (projectionUsed ? ' (projection guard prevented a worse-than-baseline outcome).' : '.'),
        counterIntuition: [], recommendations: [],
        moments: momentsObj && momentsObj.explain ? momentsObj.explain : undefined,
        cv: cv, klDivergence: kl, manualSliders: normalized01, status: 'manual-applied'
      };

    } else {
      /* ---------- SACO path (probeLevel > 0) ---------- */
      var momentsObjS;
      try { momentsObjS = computeAdjustedMoments(sliders100, 1, cv); }
      catch (e) { momentsObjS = { moments: [0, 0], explain: { error: e.message } }; }

      var mArr = momentsObjS.moments || [0, 0];
      var m0s = mArr[0], m1s = mArr[1];

      var origVar = Math.pow((pessimistic - optimistic) / 6, 2);
      var newMean  = origMean * (1 - m0s * 0.2);
      var newVar   = origVar  * (1 - m1s * 0.5);
      var scaledMu  = clamp01((newMean - optimistic) / Math.max(range, 1e-9));
      var scaledVar = Math.max(1e-12, newVar / Math.max(range * range, 1e-12));
      var denomS = scaledMu * (1 - scaledMu) / scaledVar - 1;
      var alphaS = scaledMu * denomS;
      var betaS  = (1 - scaledMu) * denomS;

      var klS = 0, usedRefitS = false;

      if (alphaS > 0 && betaS > 0 && Number.isFinite(alphaS) && Number.isFinite(betaS)) {
        var newPtsS = genBeta({
          optimistic: optimistic, mostLikely: mostLikely, pessimistic: pessimistic,
          numSamples: baseCdf.length,
          alpha: alphaS, beta: betaS
        });
        if (isValidCdf(newPtsS.cdfPoints) && isValidPdf(newPtsS.pdfPoints)) {
          newCdf = newPtsS.cdfPoints;
          newPdf = newPtsS.pdfPoints;
          usedRefitS = true;
          finalProb = Number.isFinite(tau) ? clamp01(interpCdf(newCdf, tau).value) : null;
          var safeRangeS = Math.max(1e-9, range);
          var basePdfNS = basePdf.map(function (pt) { return { x: (pt.x - optimistic) / safeRangeS, y: pt.y * safeRangeS }; });
          var newPdfNS  = newPdf.map(function (pt)  { return { x: (pt.x - optimistic) / safeRangeS, y: pt.y * safeRangeS }; });
          try {
            var klObjS = computeKLDivergence({ distributions: { triangle: { pdfPoints: newPdfNS }, monteCarloSmoothed: { pdfPoints: basePdfNS } }, task: 'saco-refit' });
            klS = Number(klObjS['triangle-monteCarloSmoothed'] || 0);
          } catch (_) { klS = 0; }
        }
      }

      if (!usedRefitS) {
        var fbS = cdfLiftFallback(baseCdf, normalized01, tau);
        newCdf = fbS.newCdf; newPdf = fbS.newPdf;
        if (fbS.finalProb !== null) finalProb = fbS.finalProb;
      }

      /* Build per-slider explain array */
      var SLIDER_W = {
        budgetFlexibility: 0.20, scheduleFlexibility: 0.20, scopeCertainty: 0.20,
        scopeReductionAllowance: 0.15, reworkPercentage: -0.15,
        riskTolerance: 0.07, userConfidence: 0.03
      };
      var slidersExplain = Object.keys(SLIDER_CATEGORIES).map(function (key) {
        var val = Number(sv[key] || 0);
        var value01 = key === 'reworkPercentage' ? clamp01(val / 50) : clamp01(val / 100);
        var lamPart = (SLIDER_W[key] || 0) * value01;
        return {
          slider: key, value: value01, category: SLIDER_CATEGORIES[key],
          weights: { blend: lamPart, leftShift: 0, tailShave: 0 },
          modeledEffect: { alpha: 0, beta: 0 },
          contribution: {
            deltaTargetProbFromRaw: (finalProb != null && baseProb != null)
              ? (finalProb - baseProb) * (Math.abs(lamPart) / (Math.abs(lamPart) + 1e-9))
              : 0,
            shareOfProjectionLift: 0
          }
        };
      });

      var bandsS = {}, catsS = {}, winningS = {};
      Object.keys(SLIDER_CATEGORIES).forEach(function (k) {
        var vRaw = Number(sv[k] || 0);
        bandsS[k] = bandOf(vRaw);
        catsS[k] = SLIDER_CATEGORIES[k];
        if (vRaw >= 50) winningS[k] = vRaw;
      });

      var rulesOut = rulesEngine(sv, baseProb, finalProb, tau);
      var deltaPts = (Number.isFinite(finalProb) && Number.isFinite(baseProb)) ? (finalProb - baseProb) * 100 : 0;

      /* Per-key moments breakdown */
      var mbS = {};
      Object.keys(sliders100).forEach(function (key) {
        var s01 = clamp01(sliders100[key] / (key === 'reworkPercentage' ? 50 : 100));
        var w = SLIDER_W[key] || 0;
        var mm0 = mArr[0] || 0, mm1 = mArr[1] || 0;
        mbS[key] = { m0: mm0 * (w * s01 / (mm0 || 1)), m1: mm1 * (w * s01 / (mm1 || 1)) };
      });

      explain = {
        baselineProb: baseProb, finalProb: finalProb,
        monotonicityAtTarget: 'Yes', allZeroSlidersPassThrough: 'No',
        sliders: slidersExplain, sliderCategories: catsS, bands: bandsS, winningSliders: winningS,
        projection: { used: false },
        narrative: 'Shape-aware blend using copula-based moments and beta refit; ΔF(τ) = ' +
          (deltaPts >= 0 ? '+' : '') + deltaPts.toFixed(2) + ' points at τ=' +
          (Number.isFinite(tau) ? tau.toFixed(3) : '–') +
          (usedRefitS ? ' (beta refit applied).' : ' (fallback CDF lift used).'),
        counterIntuition: rulesOut.counterIntuition,
        recommendations: rulesOut.recommendations,
        moments: momentsObjS && momentsObjS.explain ? momentsObjS.explain : undefined,
        cv: cv, klDivergence: klS,
        momentsBreakdown: mbS, status: 'saco-reshaped'
      };
    }

    if (!Number.isFinite(finalProb)) finalProb = 0.5;

    if (!isValidPdf(newPdf) || !isValidCdf(newCdf)) {
      return {
        probability: { value: baseProb },
        reshapedPoints: { pdfPoints: basePdf, cdfPoints: baseCdf },
        explain: Object.assign({}, explain, {
          narrative: (explain && explain.narrative ? explain.narrative : '') + ' (fallback to baseline due to invalid output points).'
        })
      };
    }

    return {
      probability: { value: finalProb },
      reshapedPoints: { pdfPoints: newPdf, cdfPoints: newCdf },
      explain: explain
    };
  }

  /**
   * Convenience alias that defaults to probeLevel=1 (SACO path).
   */
  function reshapeDistribution(args) {
    return computeSliderProbability(Object.assign({}, args, { probeLevel: args.probeLevel || 1 }));
  }

  /* ------------------------------------------------------------------ */
  /* Public API                                                          */
  /* ------------------------------------------------------------------ */

  var PMCCopula = {
    /* Constants */
    SLIDER_KEYS:        SLIDER_KEYS,
    BASE_R:             BASE_R,
    SLIDER_CATEGORIES:  SLIDER_CATEGORIES,

    /* Math helpers */
    phi:                phi,
    probit:             probit,
    clamp01:            clamp01,
    bandOf:             bandOf,

    /* Matrix / KL */
    alignPoints:        alignPoints,
    trapezoidArea:      trapezoidArea,
    renormalizePdf:     renormalizePdf,
    computeKLDivergence: computeKLDivergence,

    /* Copula / moments */
    computeCouplingSignal:  computeCouplingSignal,
    computeAdjustedMoments: computeAdjustedMoments,

    /* Beta refit */
    betaRefit: betaRefit,

    /* Rules engine */
    rulesEngine: rulesEngine,

    /* Distribution reshaping */
    computeSliderProbability: computeSliderProbability,
    reshapeDistribution:      reshapeDistribution
  };

  root.PMCCopula = PMCCopula;

})(typeof window !== 'undefined' ? window : this);
