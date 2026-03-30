/**
 * ProjectCare — Baseline Engine
 * Ported from GAS: core/baseline/*.gs + core/helpers/metrics.gs + core/helpers/validation.gs
 *
 * Covers:
 *   - Beta math  (logGamma, gammaSample, betaSample, betaPdf)
 *   - Distribution generators (Triangle, PERT, Beta, MC-raw, MC-smoothed)
 *   - Helpers  (trapezoidIntegral, ensureSortedMonotoneCdf, interpolateCdf, invertCdf, calculateMetrics)
 *   - Validation (isValidPdfArray, isValidCdfArray, createErrorResponse, validateEstimates)
 *   - High-level coordinator: generateBaseline()
 *
 * All functions are pure — no DOM, no network, no side effects.
 * Exposes: window.PMCBaseline
 */

/* global window */
(function (root) {
  'use strict';

  var B = {};

  /* ------------------------------------------------------------------ */
  /* Lanczos log-gamma                                                    */
  /* ------------------------------------------------------------------ */
  var LANCZOS_COEFFS = [
    676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7
  ];

  function logGamma(z) {
    if (z < 0.5) {
      return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
    }
    z -= 1;
    var x = 0.99999999999980993;
    for (var i = 0; i < LANCZOS_COEFFS.length; i++) {
      x += LANCZOS_COEFFS[i] / (z + i + 1);
    }
    var t = z + LANCZOS_COEFFS.length - 0.5;
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
  }

  /* ------------------------------------------------------------------ */
  /* Gamma / Beta samplers (Marsaglia-Tsang)                              */
  /* ------------------------------------------------------------------ */
  function gammaSample(shape) {
    if (shape <= 0) return NaN;
    if (shape > 1) {
      var d = shape - 1 / 3;
      var c = 1 / Math.sqrt(9 * d);
      for (;;) {
        var x, y, r2;
        do {
          x = 2 * Math.random() - 1;
          y = 2 * Math.random() - 1;
          r2 = x * x + y * y;
        } while (r2 === 0 || r2 >= 1);
        var n = x * Math.sqrt(-2 * Math.log(r2) / r2);
        var v = Math.pow(1 + c * n, 3);
        if (v <= 0) continue;
        var u = Math.random();
        if (Math.log(u) <= 0.5 * n * n + d - d * v + d * Math.log(v)) return d * v;
      }
    }
    return gammaSample(shape + 1) * Math.pow(Math.random(), 1 / shape);
  }

  function betaSample(alpha, beta) {
    var ga = gammaSample(alpha);
    var gb = gammaSample(beta);
    var s = ga + gb;
    return (ga > 0 && s > 0) ? ga / s : NaN;
  }

  /* ------------------------------------------------------------------ */
  /* Beta PDF on unit interval [0,1]                                      */
  /* ------------------------------------------------------------------ */
  function betaPdf(u, alpha, beta) {
    if (u <= 0 || u >= 1 || alpha <= 0 || beta <= 0) return 0;
    var logNum = (alpha - 1) * Math.log(u) + (beta - 1) * Math.log(1 - u);
    var logDen = logGamma(alpha) + logGamma(beta) - logGamma(alpha + beta);
    return Math.exp(logNum - logDen);
  }

  /* ------------------------------------------------------------------ */
  /* PERT (lambda=4) -> Beta parameters                                   */
  /* ------------------------------------------------------------------ */
  B.computeBetaMoments = function (params) {
    try {
      var O = params.optimistic, M = params.mostLikely, P = params.pessimistic;
      if (![O, M, P].every(Number.isFinite)) throw new Error('Estimates must be finite numbers');
      if (O > M || M > P) throw new Error('O <= M <= P required');
      var r = P - O;
      if (!(r > 0)) throw new Error('Degenerate: zero range');
      var lambda = (Number.isFinite(params.lambda) && params.lambda > 0) ? params.lambda : 4;
      var alpha = 1 + lambda * (M - O) / r;
      var beta  = 1 + lambda * (P - M) / r;
      var EPS = 1e-6;
      if (alpha < 1) alpha = 1 + EPS;
      if (beta  < 1) beta  = 1 + EPS;
      return { alpha: alpha, beta: beta };
    } catch (e) {
      return { alpha: null, beta: null, error: e.message };
    }
  };

  /* ------------------------------------------------------------------ */
  /* Validation helpers                                                   */
  /* ------------------------------------------------------------------ */
  B.isValidPdfArray = function (arr) {
    return Array.isArray(arr) && arr.length >= 2 &&
      arr.every(function (p) { return p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.y >= 0; });
  };

  B.isValidCdfArray = function (arr) {
    if (!Array.isArray(arr) || arr.length < 2) return false;
    return arr.every(function (p, i) {
      return p && Number.isFinite(p.x) && Number.isFinite(p.y) &&
        p.y >= 0 && p.y <= 1 && (i === 0 || p.y >= arr[i - 1].y);
    });
  };

  B.validateEstimates = function (O, M, P) {
    if (!Number.isFinite(O) || !Number.isFinite(M) || !Number.isFinite(P))
      return { valid: false, message: 'Estimates must be finite numbers' };
    if (O > M || M > P)
      return { valid: false, message: 'Estimates must satisfy O <= M <= P' };
    return { valid: true, message: '' };
  };

  B.createErrorResponse = function (message, details) {
    return { error: message || 'Unknown error', details: details || {} };
  };

  /* ------------------------------------------------------------------ */
  /* Trapezoid integral                                                   */
  /* ------------------------------------------------------------------ */
  B.trapezoidIntegral = function (points) {
    if (!Array.isArray(points) || points.length < 2) return 0;
    var area = 0;
    for (var i = 1; i < points.length; i++) {
      var dx = points[i].x - points[i - 1].x;
      if (!Number.isFinite(dx) || dx <= 0) continue;
      area += 0.5 * (points[i - 1].y + points[i].y) * dx;
    }
    return area;
  };

  /* ------------------------------------------------------------------ */
  /* CDF hygiene: sort, dedupe, clamp, enforce monotone, snap tail to 1   */
  /* ------------------------------------------------------------------ */
  B.ensureSortedMonotoneCdf = function (cdfPoints) {
    if (!Array.isArray(cdfPoints) || cdfPoints.length === 0) return [];
    var byX = cdfPoints
      .filter(function (p) { return p && Number.isFinite(p.x) && Number.isFinite(p.y); })
      .slice()
      .sort(function (a, b) { return a.x - b.x; })
      .reduce(function (acc, p) {
        var n = acc.length;
        var x = Number(p.x), y = Number(p.y);
        if (!n || acc[n - 1].x !== x) {
          acc.push({ x: x, y: y });
        } else if (y > acc[n - 1].y) {
          acc[n - 1].y = y;
        }
        return acc;
      }, []);
    if (byX.length === 0) return [];
    byX[0].y = Math.max(0, Math.min(1, byX[0].y));
    for (var i = 1; i < byX.length; i++) {
      var prev = byX[i - 1].y;
      var y = Math.max(0, Math.min(1, byX[i].y));
      if (y < prev) y = prev;
      byX[i].y = y;
    }
    byX[byX.length - 1].y = 1.0;
    return byX;
  };

  /* ------------------------------------------------------------------ */
  /* CDF interpolation (linear, binary search)                            */
  /* ------------------------------------------------------------------ */
  B.interpolateCdf = function (cdfPoints, xVal) {
    var out = { value: NaN };
    if (!Array.isArray(cdfPoints) || !Number.isFinite(xVal)) return out;
    var pts = B.ensureSortedMonotoneCdf(cdfPoints);
    var n = pts.length;
    if (n === 0) return out;
    if (xVal <= pts[0].x)     { out.value = pts[0].y; return out; }
    if (xVal >= pts[n - 1].x) { out.value = pts[n - 1].y; return out; }
    var lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      var mid = Math.floor((lo + hi) / 2);
      if (pts[mid].x <= xVal) lo = mid; else hi = mid;
    }
    var a = pts[lo], b = pts[hi];
    var dx = (b.x - a.x) || 1;
    var t = (xVal - a.x) / dx;
    var yv = a.y + t * (b.y - a.y);
    if (yv < a.y) yv = a.y;
    if (yv > b.y) yv = b.y;
    out.value = Math.max(0, Math.min(1, yv));
    return out;
  };

  /* ------------------------------------------------------------------ */
  /* CDF inversion / quantile function                                    */
  /* ------------------------------------------------------------------ */
  B.invertCdf = function (cdfPoints, p) {
    var cdf = B.ensureSortedMonotoneCdf(cdfPoints);
    if (cdf.length === 0) return NaN;
    var pp = Math.max(0, Math.min(1, Number(p)));
    if (pp <= cdf[0].y) return cdf[0].x;
    if (pp >= cdf[cdf.length - 1].y) return cdf[cdf.length - 1].x;
    for (var i = 1; i < cdf.length; i++) {
      var y0 = cdf[i - 1].y, y1 = cdf[i].y;
      if (pp >= y0 && pp <= y1) {
        var x0 = cdf[i - 1].x, x1 = cdf[i].x;
        var dy = (y1 - y0) || 1;
        return x0 + (pp - y0) / dy * (x1 - x0);
      }
    }
    return cdf[Math.floor(pp * (cdf.length - 1))].x;
  };

  /* ------------------------------------------------------------------ */
  /* Metrics: PERT mean + CI                                              */
  /* ------------------------------------------------------------------ */
  B.calculateMetrics = function (args) {
    var O = args.optimistic, M = args.mostLikely, P = args.pessimistic;
    var mcs = args.monteCarloSmoothed;
    var confidenceLevel = Number.isFinite(args.confidenceLevel) ? args.confidenceLevel : 0.95;
    var out = {
      pert: { mean: NaN },
      monteCarloSmoothed: { ci: { lower: NaN, upper: NaN } }
    };
    if ([O, M, P].every(Number.isFinite)) {
      out.pert.mean = (O + 4 * M + P) / 6;
    }
    var cdfRaw = (mcs && Array.isArray(mcs.cdfPoints)) ? mcs.cdfPoints : [];
    if (cdfRaw.length >= 2) {
      var cdf = B.ensureSortedMonotoneCdf(cdfRaw);
      var alpha = Math.max(0, Math.min(1, confidenceLevel));
      var loQ = (1 - alpha) / 2;
      var hiQ = 1 - loQ;
      out.monteCarloSmoothed.ci.lower = B.invertCdf(cdf, loQ);
      out.monteCarloSmoothed.ci.upper = B.invertCdf(cdf, hiQ);
    }
    return out;
  };

  /* ------------------------------------------------------------------ */
  /* Triangle distribution                                                */
  /* ------------------------------------------------------------------ */
  B.generateTrianglePoints = function (params) {
    try {
      var O = params.optimistic, M = params.mostLikely, P = params.pessimistic;
      var n = params.numSamples || 200;
      if (!Number.isFinite(O) || !Number.isFinite(M) || !Number.isFinite(P))
        throw new Error('Estimates must be finite');
      if (O > M || M > P) throw new Error('O <= M <= P required');
      var range = P - O;
      if (range <= 0) throw new Error('Degenerate range');
      var step = range / (n - 1);
      var height = 2 / range;
      var leftDen = M - O, rightDen = P - M;
      var pdf = [];
      for (var i = 0; i < n; i++) {
        var x = O + i * step;
        var y = 0;
        if (x >= O && x <= M) {
          y = leftDen > 0 ? height * (x - O) / leftDen : 0;
        } else if (x > M && x <= P) {
          y = rightDen > 0 ? height * (P - x) / rightDen : 0;
        }
        if (!Number.isFinite(y)) throw new Error('Invalid PDF value at x=' + x);
        pdf.push({ x: x, y: y });
      }
      var area = B.trapezoidIntegral(pdf);
      if (!Number.isFinite(area) || area <= 0) throw new Error('Invalid PDF area');
      var normPdf = pdf.map(function (p) { return { x: p.x, y: p.y / area }; });
      var cdf = [{ x: normPdf[0].x, y: 0 }];
      var cum = 0;
      for (var i = 1; i < normPdf.length; i++) {
        var dx = normPdf[i].x - normPdf[i - 1].x;
        cum += 0.5 * (normPdf[i].y + normPdf[i - 1].y) * dx;
        cdf.push({ x: normPdf[i].x, y: Math.max(0, Math.min(1, cum)) });
      }
      return { pdfPoints: normPdf, cdfPoints: cdf };
    } catch (e) {
      return { pdfPoints: [], cdfPoints: [], error: e.message };
    }
  };

  /* ------------------------------------------------------------------ */
  /* Beta distribution points (arbitrary alpha, beta)                    */
  /* ------------------------------------------------------------------ */
  B.generateBetaPoints = function (params) {
    try {
      var O = params.optimistic, M = params.mostLikely, P = params.pessimistic;
      var n = params.numSamples || 200;
      var alpha = params.alpha, beta = params.beta;
      if (!Number.isFinite(O) || !Number.isFinite(M) || !Number.isFinite(P))
        throw new Error('Estimates must be finite');
      if (O > M || M > P) throw new Error('O <= M <= P required');
      var r = P - O;
      if (!(r > 0)) throw new Error('Degenerate range');
      if (!Number.isFinite(alpha) || !Number.isFinite(beta) || alpha <= 0 || beta <= 0)
        throw new Error('Invalid alpha/beta: ' + alpha + '/' + beta);
      var step = r / (n - 1);
      var pdf = [];
      for (var i = 0; i < n; i++) {
        var x = O + i * step;
        var u = (x - O) / r;
        var y = betaPdf(u, alpha, beta) / r;
        if (!Number.isFinite(y) || y < 0) y = 0;
        pdf.push({ x: x, y: y });
      }
      var area = B.trapezoidIntegral(pdf);
      if (!(area > 0)) throw new Error('Invalid PDF area: ' + area);
      var normPdf = pdf.map(function (p) { return { x: p.x, y: p.y / area }; });
      var cdf = [{ x: normPdf[0].x, y: 0 }];
      var cum = 0;
      for (var i = 1; i < normPdf.length; i++) {
        var dx = normPdf[i].x - normPdf[i - 1].x;
        cum += 0.5 * (normPdf[i - 1].y + normPdf[i].y) * dx;
        cdf.push({ x: normPdf[i].x, y: Math.max(0, Math.min(1, cum)) });
      }
      return { pdfPoints: normPdf, cdfPoints: cdf };
    } catch (e) {
      return { pdfPoints: [], cdfPoints: [], error: e.message };
    }
  };

  /* ------------------------------------------------------------------ */
  /* PERT distribution (Beta with lambda=4 parameterisation)              */
  /* ------------------------------------------------------------------ */
  B.generatePertPoints = function (params) {
    try {
      var bm = B.computeBetaMoments(params);
      if (bm.error) throw new Error(bm.error);
      return B.generateBetaPoints({
        optimistic: params.optimistic,
        mostLikely: params.mostLikely,
        pessimistic: params.pessimistic,
        numSamples: params.numSamples || 200,
        alpha: bm.alpha,
        beta: bm.beta
      });
    } catch (e) {
      return { pdfPoints: [], cdfPoints: [], error: e.message };
    }
  };

  /* ------------------------------------------------------------------ */
  /* Monte Carlo raw (Beta samples -> histogram)                          */
  /* ------------------------------------------------------------------ */
  B.generateMonteCarloRawPoints = function (params) {
    try {
      var O = params.optimistic, M = params.mostLikely, P = params.pessimistic;
      var nSamples = params.numSamples || 1000;
      var range = P - O;
      if (range <= 0) throw new Error('Degenerate range');
      var bm = B.computeBetaMoments(params);
      if (bm.error) throw new Error(bm.error);
      var samples = [];
      for (var i = 0; i < nSamples; i++) {
        var u = betaSample(bm.alpha, bm.beta);
        samples.push(O + u * range);
      }
      var eff = Math.max(50, Math.min(nSamples, Math.ceil(range / 10)));
      var step = range / (eff - 1);
      var hist = [];
      for (var i = 0; i < eff; i++) hist.push(0);
      for (var k = 0; k < samples.length; k++) {
        var idx = Math.min(eff - 1, Math.max(0, Math.floor((samples[k] - O) / step)));
        hist[idx]++;
      }
      var pdf = hist.map(function (count, i) {
        return { x: O + (i + 0.5) * step, y: count / (nSamples * step) };
      });
      var sorted = samples.slice().sort(function (a, b) { return a - b; });
      var cdf = sorted.map(function (s, i) { return { x: s, y: i / nSamples }; });
      return { pdfPoints: pdf, cdfPoints: cdf, samples: sorted };
    } catch (e) {
      return { pdfPoints: [], cdfPoints: [], samples: [], error: e.message };
    }
  };

  /* ------------------------------------------------------------------ */
  /* Monte Carlo smoothed (KDE baseline -- the active distribution)       */
  /* ------------------------------------------------------------------ */
  B.generateMonteCarloSmoothedPoints = function (params) {
    try {
      var O = params.optimistic, M = params.mostLikely, P = params.pessimistic;
      var nSamples = params.numSamples || 2000;
      var rawSamples = params.samples || null;
      if (!Number.isFinite(O) || !Number.isFinite(M) || !Number.isFinite(P))
        throw new Error('Estimates must be finite');
      if (!(O <= M && M <= P)) throw new Error('O <= M <= P required');
      var range = P - O;
      if (range <= 0) throw new Error('Degenerate range');

      var samples;
      if (Array.isArray(rawSamples) && rawSamples.length > 0) {
        samples = rawSamples.slice();
      } else {
        var bm = B.computeBetaMoments({ optimistic: O, mostLikely: M, pessimistic: P });
        if (!Number.isFinite(bm.alpha) || !Number.isFinite(bm.beta) || bm.alpha <= 0 || bm.beta <= 0)
          throw new Error('Invalid beta parameters');
        samples = [];
        for (var i = 0; i < nSamples; i++) {
          samples.push(O + betaSample(bm.alpha, bm.beta) * range);
        }
      }
      samples = samples
        .map(function (s) { return Math.max(O, Math.min(P, Number(s))); })
        .filter(Number.isFinite);

      // Gaussian KDE on 200-point grid; bandwidth = range/63.3
      var nPoints = 200;
      var h = range / 63.3;
      var invH = 1 / h;
      var invSqrt2pi = 1 / Math.sqrt(2 * Math.PI);
      var pdf = [];
      for (var i = 0; i < nPoints; i++) {
        var x = O + i * (range / (nPoints - 1));
        var sum = 0;
        for (var k = 0; k < samples.length; k++) {
          var z = (x - samples[k]) * invH;
          sum += Math.exp(-0.5 * z * z) * invH * invSqrt2pi;
        }
        pdf.push({ x: x, y: sum / samples.length });
      }

      var area = B.trapezoidIntegral(pdf);
      if (!(area > 0 && Number.isFinite(area))) throw new Error('Invalid PDF integral');
      var nPdf = pdf.map(function (p) { return { x: p.x, y: p.y / area }; });

      var cdfRaw = [{ x: nPdf[0].x, y: 0 }];
      var cum = 0;
      for (var i = 1; i < nPdf.length; i++) {
        var dxSeg = nPdf[i].x - nPdf[i - 1].x;
        cum += 0.5 * (nPdf[i - 1].y + nPdf[i].y) * dxSeg;
        cdfRaw.push({ x: nPdf[i].x, y: Math.max(0, Math.min(1, cum)) });
      }
      var cdf = B.ensureSortedMonotoneCdf(cdfRaw);
      if (cdf.length) cdf[cdf.length - 1].y = 1.0;

      if (!B.isValidPdfArray(nPdf) || !B.isValidCdfArray(cdf))
        throw new Error('Invalid PDF/CDF output');

      return { pdfPoints: nPdf, cdfPoints: cdf };
    } catch (e) {
      return { pdfPoints: [], cdfPoints: [], error: e.message };
    }
  };

  /* ------------------------------------------------------------------ */
  /* Box-Muller standard normal sampler (for MCMC)                       */
  /* ------------------------------------------------------------------ */
  function normalSampleBM() {
    var u, v, s;
    do {
      u = 2 * Math.random() - 1;
      v = 2 * Math.random() - 1;
      s = u * u + v * v;
    } while (s === 0 || s >= 1);
    return u * Math.sqrt(-2 * Math.log(s) / s);
  }

  /* ------------------------------------------------------------------ */
  /* MCMC Bayesian baseline (Bayesian posterior update over overrun)      */
  /* Replaces generateMonteCarloSmoothedPoints when priorHistory given.   */
  /*                                                                      */
  /* Model: μ_overrun | data ~ N(muPost, sigmaPost²)                     */
  /* where muPost, sigmaPost come from Normal-Normal conjugate update.    */
  /* Each PERT sample is multiplied by (1 + draw_from_posterior).        */
  /* Research: Gelman et al. BDA3 §2.5; Flyvbjerg (2002) overrun data.  */
  /* ------------------------------------------------------------------ */
  B.generateMCMCSmoothedPoints = function (params) {
    try {
      var O = params.optimistic, M = params.mostLikely, P = params.pessimistic;
      var nSamples = params.numSamples || 2000;
      var ph = params.priorHistory;

      if (!Number.isFinite(O) || !Number.isFinite(M) || !Number.isFinite(P))
        throw new Error('Estimates must be finite');
      if (!(O <= M && M <= P)) throw new Error('O <= M <= P required');
      var range = P - O;
      if (range <= 0) throw new Error('Degenerate range');
      if (!ph || !Number.isFinite(ph.n) || ph.n < 1 || !Number.isFinite(ph.meanOverrunFrac))
        throw new Error('priorHistory.n and meanOverrunFrac required');

      var nHist     = Math.round(ph.n);
      var muData    = ph.meanOverrunFrac;
      var sigmaObs  = (Number.isFinite(ph.stdOverrunFrac) && ph.stdOverrunFrac > 0)
                      ? ph.stdOverrunFrac
                      : Math.max(0.05, Math.abs(muData) * 0.5);

      // Normal-Normal conjugate posterior
      var sigmaPrior = 0.30, muPrior = 0.0;
      var varPrior   = sigmaPrior * sigmaPrior;
      var varLik     = (sigmaObs * sigmaObs) / nHist;
      var varPost    = 1 / (1 / varPrior + 1 / varLik);
      var muPost     = varPost * (muPrior / varPrior + muData / varLik);
      var sigmaPost  = Math.sqrt(varPost);

      var bm = B.computeBetaMoments({ optimistic: O, mostLikely: M, pessimistic: P });
      if (!Number.isFinite(bm.alpha) || !Number.isFinite(bm.beta) || bm.alpha <= 0 || bm.beta <= 0)
        throw new Error('Invalid beta parameters');

      var extendedMax = P * (1 + Math.max(0, muPost + 3 * sigmaPost));
      var samples = [];
      for (var i = 0; i < nSamples; i++) {
        var base     = O + betaSample(bm.alpha, bm.beta) * range;
        var overrun  = muPost + sigmaPost * normalSampleBM();
        var adjusted = base * (1 + overrun);
        var clamped  = Math.max(O, Math.min(extendedMax, adjusted));
        if (Number.isFinite(clamped)) samples.push(clamped);
      }

      var nPoints = 200;
      var xMin = O, xMax = Math.max(P, extendedMax);
      var gridRange = xMax - xMin;
      var h = gridRange / 63.3;
      var invH = 1 / h;
      var invSqrt2pi = 1 / Math.sqrt(2 * Math.PI);
      var pdf = [];
      for (var i = 0; i < nPoints; i++) {
        var x = xMin + i * (gridRange / (nPoints - 1));
        var sum = 0;
        for (var k = 0; k < samples.length; k++) {
          var z = (x - samples[k]) * invH;
          sum += Math.exp(-0.5 * z * z) * invH * invSqrt2pi;
        }
        pdf.push({ x: x, y: sum / samples.length });
      }

      var area = B.trapezoidIntegral(pdf);
      if (!(area > 0 && Number.isFinite(area))) throw new Error('Invalid PDF area');
      var nPdf = pdf.map(function (p) { return { x: p.x, y: p.y / area }; });

      var cdfRaw = [{ x: nPdf[0].x, y: 0 }];
      var cum = 0;
      for (var i = 1; i < nPdf.length; i++) {
        var dx = nPdf[i].x - nPdf[i - 1].x;
        cum += 0.5 * (nPdf[i - 1].y + nPdf[i].y) * dx;
        cdfRaw.push({ x: nPdf[i].x, y: Math.max(0, Math.min(1, cum)) });
      }
      var cdf = B.ensureSortedMonotoneCdf(cdfRaw);
      if (cdf.length) cdf[cdf.length - 1].y = 1.0;

      if (!B.isValidPdfArray(nPdf) || !B.isValidCdfArray(cdf))
        throw new Error('Invalid PDF/CDF output');

      return {
        pdfPoints: nPdf,
        cdfPoints: cdf,
        posteriorStats: {
          muPost: muPost, sigmaPost: sigmaPost,
          nHist: nHist, credibility: Math.min(1, nHist / 10)
        }
      };
    } catch (e) {
      // Fallback to standard MC smoothing
      console.warn('generateMCMCSmoothedPoints fallback:', e.message);
      return B.generateMonteCarloSmoothedPoints(params);
    }
  };

  /* ------------------------------------------------------------------ */
  /* High-level coordinator: generateBaseline                             */
  /* ------------------------------------------------------------------ */
  B.generateBaseline = function (params) {
    try {
      var O = params.optimistic, M = params.mostLikely, P = params.pessimistic;
      var numSamples = params.numSamples || 200;
      var suppress = !!params.suppressOtherDistros;
      var lambda = (Number.isFinite(params.lambda) && params.lambda > 0) ? params.lambda : 4;

      if (![O, M, P].every(Number.isFinite)) throw new Error('Estimates must be finite');
      if (!(O <= M && M <= P)) throw new Error('O <= M <= P required');

      var bm = B.computeBetaMoments({ optimistic: O, mostLikely: M, pessimistic: P, lambda: lambda });
      if (!(bm.alpha > 0 && bm.beta > 0)) throw new Error('Invalid beta parameters');

      // Triangle -- always generated (needed for KL divergence)
      var trianglePoints = B.generateTrianglePoints({
        optimistic: O, mostLikely: M, pessimistic: P, numSamples: numSamples
      });
      if (trianglePoints.error || !B.isValidPdfArray(trianglePoints.pdfPoints))
        throw new Error('Triangle generation failed');
      trianglePoints.cdfPoints = B.ensureSortedMonotoneCdf(trianglePoints.cdfPoints);

      // Optional distributions (skip when suppressOtherDistros=true for performance)
      var pertPoints, betaPoints;
      if (!suppress) {
        pertPoints = B.generatePertPoints({
          optimistic: O, mostLikely: M, pessimistic: P, numSamples: numSamples, lambda: lambda
        });
        betaPoints = B.generateBetaPoints({
          optimistic: O, mostLikely: M, pessimistic: P, numSamples: numSamples,
          alpha: bm.alpha, beta: bm.beta
        });
        if (pertPoints.error || !B.isValidPdfArray(pertPoints.pdfPoints))
          throw new Error('PERT generation failed');
        if (betaPoints.error || !B.isValidPdfArray(betaPoints.pdfPoints))
          throw new Error('Beta generation failed');
        pertPoints.cdfPoints  = B.ensureSortedMonotoneCdf(pertPoints.cdfPoints);
        betaPoints.cdfPoints  = B.ensureSortedMonotoneCdf(betaPoints.cdfPoints);
      }

      // Monte Carlo smoothed -- always generated, this is the active baseline.
      // Use MCMC Bayesian posterior update when priorHistory is provided and valid.
      var hasPriorHistory = params.priorHistory &&
        Number.isFinite(params.priorHistory.n) && params.priorHistory.n >= 1 &&
        Number.isFinite(params.priorHistory.meanOverrunFrac);
      var mcParams = { optimistic: O, mostLikely: M, pessimistic: P, numSamples: 2000 };
      if (hasPriorHistory) mcParams.priorHistory = params.priorHistory;
      var mcSmoothed = hasPriorHistory
        ? B.generateMCMCSmoothedPoints(mcParams)
        : B.generateMonteCarloSmoothedPoints(mcParams);
      if (mcSmoothed.error || !B.isValidPdfArray(mcSmoothed.pdfPoints))
        throw new Error('MC smoothed generation failed: ' + (mcSmoothed.error || ''));
      mcSmoothed.cdfPoints = B.ensureSortedMonotoneCdf(mcSmoothed.cdfPoints);
      if (mcSmoothed.cdfPoints.length)
        mcSmoothed.cdfPoints[mcSmoothed.cdfPoints.length - 1].y = 1.0;

      // 95% CI
      var cdf = mcSmoothed.cdfPoints;
      var ciLower = B.invertCdf(cdf, 0.025);
      var ciUpper = B.invertCdf(cdf, 0.975);
      mcSmoothed.ci = { lower: ciLower, upper: ciUpper };

      var metrics = B.calculateMetrics({
        optimistic: O, mostLikely: M, pessimistic: P,
        monteCarloSmoothed: { pdfPoints: mcSmoothed.pdfPoints, cdfPoints: mcSmoothed.cdfPoints },
        confidenceLevel: 0.95
      });
      var pertMean = Number(metrics.pert.mean);

      return {
        trianglePoints: trianglePoints,
        pertPoints: pertPoints,
        betaPoints: betaPoints,
        monteCarloSmoothedPoints: mcSmoothed,
        monteCarloSmoothed: {
          pdfPoints: mcSmoothed.pdfPoints,
          cdfPoints: mcSmoothed.cdfPoints,
          ci: mcSmoothed.ci
        },
        ci: { monteCarloSmoothed: mcSmoothed.ci },
        confidenceInterval: { lower: ciLower, upper: ciUpper },
        pert: { mean: pertMean },
        alpha: bm.alpha,
        beta: bm.beta,
        posteriorStats: mcSmoothed.posteriorStats || null,
        baselineMode: hasPriorHistory ? 'mcmc' : 'montecarlo',
        error: null
      };
    } catch (e) {
      return { error: 'generateBaseline: ' + e.message };
    }
  };

  /* ------------------------------------------------------------------ */
  /* PDF -> CDF via trapezoid (convenience)                               */
  /* ------------------------------------------------------------------ */
  B.pdfToCdf = function (pdfPoints) {
    if (!pdfPoints || pdfPoints.length < 2) return [];
    var cdf = [{ x: pdfPoints[0].x, y: 0 }];
    var cum = 0;
    for (var i = 1; i < pdfPoints.length; i++) {
      var dx = pdfPoints[i].x - pdfPoints[i - 1].x;
      cum += 0.5 * (pdfPoints[i].y + pdfPoints[i - 1].y) * dx;
      cdf.push({ x: pdfPoints[i].x, y: Math.min(1, cum) });
    }
    return cdf;
  };

  /* ------------------------------------------------------------------ */
  /* Interpolate Y at X from a {x,y}[] series                            */
  /* ------------------------------------------------------------------ */
  B.interpY = function (series, x) {
    if (!series || series.length === 0) return null;
    if (x <= series[0].x) return series[0].y;
    if (x >= series[series.length - 1].x) return series[series.length - 1].y;
    for (var i = 1; i < series.length; i++) {
      if (series[i].x >= x) {
        var t = (x - series[i - 1].x) / (series[i].x - series[i - 1].x);
        return series[i - 1].y + t * (series[i].y - series[i - 1].y);
      }
    }
    return null;
  };

  root.PMCBaseline = B;

})(typeof window !== 'undefined' ? window : this);
