/**
 * ProjectCare — SACO Orchestrator
 * Ported from GAS: core/main/main.gs + core/variable_map/adapter.gs
 *
 * Entry point: PMCSACO.run(task) → full response envelope
 * Batch:       PMCSACO.runAll(tasks[]) → { results, error }
 *
 * Exposes: window.PMCSACO
 * Depends on: window.PMCBaseline, window.PMCCopula, window.PMCOptimizer
 * All pure math — no DOM, no network.
 */

(function (root) {
  'use strict';

  var SCHEMA_VERSION = '2025-10-16.api-envelope.v1';
  var MAX_POINTS     = 200;
  var BUILD_TAG      = 'browser-saco-v1.0.0';
  var SLIDER_KEYS    = [
    'budgetFlexibility', 'scheduleFlexibility', 'scopeCertainty',
    'scopeReductionAllowance', 'reworkPercentage', 'riskTolerance', 'userConfidence'
  ];

  /* ------------------------------------------------------------------ */
  /* Cross-module references                                             */
  /* ------------------------------------------------------------------ */
  function B() { return root.PMCBaseline; }
  function C() { return root.PMCCopula; }
  function O() { return root.PMCOptimizer; }

  /* ------------------------------------------------------------------ */
  /* Utilities                                                           */
  /* ------------------------------------------------------------------ */

  function asArray(x) {
    if (Array.isArray(x)) return x;
    if (x && Array.isArray(x.value)) return x.value;
    return [];
  }

  function asNum(x) {
    return (typeof x === 'number' && Number.isFinite(x)) ? x : undefined;
  }

  function coercePercent01(x) {
    return Math.max(0, Math.min(1, Number(x) || 0));
  }

  function asPointsArray(maybe) {
    if (Array.isArray(maybe)) return maybe;
    if (maybe && Array.isArray(maybe.value)) return maybe.value;
    return [];
  }

  function clipPoints(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.slice(0, MAX_POINTS);
  }

  function coalesce() {
    for (var i = 0; i < arguments.length; i++) {
      if (arguments[i] !== undefined && arguments[i] !== null) return arguments[i];
    }
    return undefined;
  }

  function extractError(e) {
    var message = (e && (e.message || e.error)) || (typeof e === 'string' ? e : 'Unknown error');
    var details = (e && (e.details || e)) || {};
    return { message: message, details: details };
  }

  /**
   * Convert UI slider units → normalized 0..1 domain.
   * reworkPercentage uses ÷50 domain; all others ÷100.
   */
  function to01FromUi(sliders) {
    var out = {};
    if (!sliders || typeof sliders !== 'object') return out;
    out.budgetFlexibility       = Math.max(0, Math.min(1, (Number(sliders.budgetFlexibility) || 0) / 100));
    out.scheduleFlexibility     = Math.max(0, Math.min(1, (Number(sliders.scheduleFlexibility) || 0) / 100));
    out.scopeCertainty          = Math.max(0, Math.min(1, (Number(sliders.scopeCertainty) || 0) / 100));
    out.scopeReductionAllowance = Math.max(0, Math.min(1, (Number(sliders.scopeReductionAllowance) || 0) / 100));
    out.reworkPercentage        = Math.max(0, Math.min(0.5, (Number(sliders.reworkPercentage) || 0) / 50));
    out.riskTolerance           = Math.max(0, Math.min(1, (Number(sliders.riskTolerance) || 0) / 100));
    var uc = (sliders.userConfidence == null) ? 100 : Number(sliders.userConfidence);
    out.userConfidence          = Math.max(0, Math.min(1, (Number.isFinite(uc) ? uc : 100) / 100));
    return out;
  }

  /** Normalize a slider block to strict 0..1 (handles old % payloads). */
  function normalizeSliderBlock01(block) {
    if (!block || typeof block !== 'object') return null;
    var out = {};
    Object.keys(block).forEach(function (k) {
      var n = Number(block[k]);
      if (!Number.isFinite(n)) return;
      if (n > 1) n = n / 100;
      if (n < 0) n = 0;
      if (n > 1) n = 1;
      out[k] = n;
    });
    return Object.keys(out).length ? out : null;
  }

  /** Pick optimized slider values from whatever shape the result has. */
  function pickOptimizedSliders(optRes) {
    var cands = [
      optRes && optRes.sliders,
      optRes && optRes.scaledSliders,
      optRes && optRes.optimizedResult && optRes.optimizedResult.sliders,
      optRes && optRes.best && optRes.best.sliders,
      optRes && optRes.solution && optRes.solution.sliders
    ];
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      if (c && typeof c === 'object') {
        var out = {};
        SLIDER_KEYS.forEach(function (k) { if (Number.isFinite(c[k])) out[k] = Number(c[k]); });
        if (Object.keys(out).length) return out;
      }
    }
    return {};
  }

  /** Build a report entry from explain block. */
  function toReportEntry(modeLabel, targetValue, baselineProbability, finalProbability, explain, certificateRaw) {
    function safe(x) { return Number.isFinite(x) ? Number(x) : null; }
    var lift = safe(finalProbability - baselineProbability);
    return {
      mode: modeLabel,
      narrative: (explain && explain.narrative) || '',
      target: safe(targetValue),
      baselineProbability: safe(baselineProbability),
      finalProbability: safe(finalProbability),
      liftPoints: lift,
      lambda: (explain && explain.projection && Number.isFinite(explain.projection.lambda)) ? explain.projection.lambda : null,
      certificate: typeof certificateRaw === 'string' ? certificateRaw : (certificateRaw ? JSON.stringify(certificateRaw) : '—'),
      diagnostics: {
        monotonicityAtTarget: (explain && explain.monotonicityAtTarget) || 'N/A',
        allZeroSlidersPassThrough: (explain && explain.allZeroSlidersPassThrough) || 'N/A',
        winnerHasSliders: !!(explain && explain.winningSliders && Object.keys(explain.winningSliders).length)
      },
      counterIntuition: (explain && Array.isArray(explain.counterIntuition)) ? explain.counterIntuition : [],
      recommendations:  (explain && Array.isArray(explain.recommendations))  ? explain.recommendations  : [],
      bands: (explain && explain.bands) || {},
      winningSliders: (explain && explain.winningSliders) || {},
      sliderCategories: (explain && explain.sliderCategories) || {}
    };
  }

  /* ------------------------------------------------------------------ */
  /* Core task processor                                                 */
  /* ------------------------------------------------------------------ */

  function processTask(task) {
    try {
      var Bas = B(), Cop = C(), Opt = O();

      var taskName       = (task && task.task) || 'Unnamed';
      var optimistic     = task.optimistic;
      var mostLikely     = task.mostLikely;
      var pessimistic    = task.pessimistic;
      var targetValue    = task.targetValue;
      var confidenceLevel = (task.confidenceLevel != null) ? task.confidenceLevel : 0.95;
      var optimize       = (task.optimize !== undefined) ? !!task.optimize : true;
      var optimizeFor    = task.optimizeFor || 'target';
      var inputSliders   = task.sliderValues || {};
      var suppressOther  = !!task.suppressOtherDistros;
      var randomSeed     = (task.randomSeed != null) ? task.randomSeed : Date.now();
      var adaptive       = (task.adaptive !== undefined) ? !!task.adaptive : true;
      var probeLevel     = (task.probeLevel != null) ? Math.max(0, Math.min(7, Math.floor(Number(task.probeLevel)))) : 5;
      var lambda         = (Number.isFinite(task.lambda) && task.lambda > 0) ? task.lambda : 4;
      var priorHistory   = (task.priorHistory && Number.isFinite(task.priorHistory.n)) ? task.priorHistory : undefined;

      var hasTarget = Number.isFinite(targetValue);

      /* ----- Input validation ----- */
      if (Bas && Bas.validateEstimates) {
        var estVal = Bas.validateEstimates(optimistic, mostLikely, pessimistic);
        if (!estVal.valid) throw new Error(estVal.message || 'Invalid estimates');
      } else {
        if (!(optimistic < mostLikely && mostLikely < pessimistic)) throw new Error('Invalid triangular: need O < M < P');
        if (!Number.isFinite(optimistic) || !Number.isFinite(mostLikely) || !Number.isFinite(pessimistic)) throw new Error('Non-finite estimates');
      }
      if (!(confidenceLevel > 0 && confidenceLevel < 1)) throw new Error('Invalid confidenceLevel');

      /* ----- Sliders (UI units) ----- */
      var slidersUi = to01FromUi(inputSliders);

      /* ----- Baseline (MC-smoothed reference geometry) ----- */
      var baselineRaw = Bas ? Bas.generateBaseline({
        optimistic: optimistic, mostLikely: mostLikely, pessimistic: pessimistic,
        numSamples: MAX_POINTS, suppressOtherDistros: suppressOther, randomSeed: randomSeed,
        lambda: lambda, priorHistory: priorHistory
      }) : null;

      if (!baselineRaw || baselineRaw.error) throw new Error('generateBaseline failed: ' + (baselineRaw && baselineRaw.error ? baselineRaw.error : 'null result'));

      /* Extract MC-smoothed PDF/CDF */
      var mcBlock =
        baselineRaw.monteCarloSmoothedPoints ||
        baselineRaw.monteCarloSmoothed ||
        baselineRaw.monteCarlo ||
        (baselineRaw.distributions && baselineRaw.distributions.monteCarloSmoothed) ||
        null;

      var pdf = asPointsArray(mcBlock && mcBlock.pdfPoints) || asPointsArray(mcBlock && mcBlock.pdf);
      var cdf = asPointsArray(mcBlock && mcBlock.cdfPoints) || asPointsArray(mcBlock && mcBlock.cdf);

      var isValidPdf = Bas ? Bas.isValidPdfArray : function (a) { return Array.isArray(a) && a.length >= 2; };
      var isValidCdf = Bas ? Bas.isValidCdfArray : function (a) { return Array.isArray(a) && a.length >= 2; };
      var interpCdf  = Bas ? Bas.interpolateCdf  : function () { return { value: 0.5 }; };

      if (!isValidPdf(pdf) || !isValidCdf(cdf)) throw new Error('Invalid MC-smoothed baseline points');

      /* Triangle / PERT for supplementary display */
      var triangleBlock   = baselineRaw.trianglePoints || baselineRaw.triangle || (baselineRaw.distributions && baselineRaw.distributions.triangle);
      var betaPertBlock   = baselineRaw.pertPoints     || baselineRaw.betaPert  || (baselineRaw.distributions && baselineRaw.distributions.betaPert);
      var trianglePdfPts  = asPointsArray(triangleBlock && triangleBlock.pdfPoints) || asPointsArray(triangleBlock && triangleBlock.pdf);
      var triangleCdfPts  = asPointsArray(triangleBlock && triangleBlock.cdfPoints) || asPointsArray(triangleBlock && triangleBlock.cdf);
      var betaPertPdfPts  = asPointsArray(betaPertBlock && betaPertBlock.pdfPoints) || asPointsArray(betaPertBlock && betaPertBlock.pdf);
      var betaPertCdfPts  = asPointsArray(betaPertBlock && betaPertBlock.cdfPoints) || asPointsArray(betaPertBlock && betaPertBlock.cdf);

      /* Metrics */
      var metrics = null;
      if (Bas && Bas.calculateMetrics) {
        metrics = Bas.calculateMetrics({
          optimistic: optimistic, mostLikely: mostLikely, pessimistic: pessimistic,
          triangle: trianglePdfPts.length ? { pdfPoints: trianglePdfPts, cdfPoints: triangleCdfPts } : undefined,
          monteCarloSmoothed: { pdfPoints: pdf, cdfPoints: cdf },
          confidenceLevel: confidenceLevel, robustStd: 0
        });
      }

      var pertMean = metrics && metrics.pert ? Number(metrics.pert.mean) : (optimistic + 4 * mostLikely + pessimistic) / 6;
      var ciLower  = metrics && metrics.monteCarloSmoothed && metrics.monteCarloSmoothed.ci ? Number(metrics.monteCarloSmoothed.ci.lower) : undefined;
      var ciUpper  = metrics && metrics.monteCarloSmoothed && metrics.monteCarloSmoothed.ci ? Number(metrics.monteCarloSmoothed.ci.upper) : undefined;

      /* Baseline probabilities */
      var baseProbRaw = hasTarget ? interpCdf(cdf, targetValue) : null;
      var baseProb    = baseProbRaw ? coercePercent01(typeof baseProbRaw === 'object' ? baseProbRaw.value : baseProbRaw) : null;
      var baseProbAtPertRaw = Number.isFinite(pertMean) ? interpCdf(cdf, pertMean) : null;
      var baseProbAtPert    = baseProbAtPertRaw ? coercePercent01(typeof baseProbAtPertRaw === 'object' ? baseProbAtPertRaw.value : baseProbAtPertRaw) : undefined;

      /* KL baseline vs triangle (diagnostic) */
      var klToTriangle;
      if (Cop && Cop.computeKLDivergence && trianglePdfPts.length && pdf.length) {
        try {
          var klObj = Cop.computeKLDivergence({
            distributions: { triangle: { pdfPoints: trianglePdfPts }, monteCarloSmoothed: { pdfPoints: pdf } },
            task: taskName
          });
          klToTriangle = Number(klObj['triangle-monteCarloSmoothed'] || 0);
        } catch (_) {}
      }

      /* ---------------------------------------------------------------- */
      /* Adjusted (manual sliders) — SACO reshape                        */
      /* ---------------------------------------------------------------- */
      var adjRes = null;
      try {
        if (Cop && Cop.reshapeDistribution) {
          adjRes = Cop.reshapeDistribution({
            points: { pdfPoints: pdf, cdfPoints: cdf },
            optimistic: optimistic, mostLikely: mostLikely, pessimistic: pessimistic,
            targetValue: targetValue,
            sliderValues: inputSliders,
            probeLevel: 1
          });
        }
      } catch (err) {
        adjRes = { error: err.message, explain: { narrative: 'Manual SACO reshape error: ' + err.message } };
      }

      var adjustedBlock;
      if (!adjRes || adjRes.error) {
        adjustedBlock = {
          status: 'error', reasonCode: 'adjusted_error',
          message: (adjRes && adjRes.error) || 'Unknown adjusted error',
          explain: (adjRes && adjRes.explain) || null
        };
      } else {
        adjustedBlock = {
          status: 'ok',
          probabilityAtTarget: {
            value: hasTarget ? coercePercent01(adjRes.probability && adjRes.probability.value) : undefined
          },
          reshapedPoints: {
            pdfPoints: clipPoints(asPointsArray((adjRes.reshapedPoints && adjRes.reshapedPoints.pdfPoints) || pdf)),
            cdfPoints: clipPoints(asPointsArray((adjRes.reshapedPoints && adjRes.reshapedPoints.cdfPoints) || cdf))
          },
          explain: adjRes.explain || null
        };
      }

      var allZeroPassThrough = !!(adjustedBlock.explain &&
        String(adjustedBlock.explain.allZeroSlidersPassThrough || '').toLowerCase() === 'yes');

      /* ---------------------------------------------------------------- */
      /* Optimization (SACO fixed/adaptive) — optional                   */
      /* ---------------------------------------------------------------- */
      var optimizeBlock = { status: 'skipped', reasonCode: !optimize ? 'optimize_false' : (probeLevel === 0 ? 'probe_zero' : 'not_requested') };
      var manualOptimizeBlock = null;
      var tp_adjustedOptimized, tp_adaptiveOptimized;

      if (optimize && probeLevel > 0 && Opt && Opt.optimizeSliders) {
        /* Stage 1 — Fixed (always runs first as seed) */
        var fixedRes = Opt.optimizeSliders({
          points: { pdfPoints: pdf, cdfPoints: cdf },
          optimistic: optimistic, mostLikely: mostLikely, pessimistic: pessimistic,
          targetValue: Number.isFinite(targetValue) ? targetValue : pertMean,
          randomSeed: randomSeed, adaptive: false, probeLevel: 1
        });

        var seedBest = null;
        if (fixedRes && !fixedRes.error) {
          seedBest = {
            sliders01: fixedRes.sliders01 || pickOptimizedSliders(fixedRes),
            finalProb: fixedRes.finalProb || baseProb
          };
        }

        /* Stage 2 — Adaptive (if requested) */
        var adaptiveRes = null;
        if (adaptive) {
          adaptiveRes = Opt.optimizeSliders({
            points: { pdfPoints: pdf, cdfPoints: cdf },
            optimistic: optimistic, mostLikely: mostLikely, pessimistic: pessimistic,
            targetValue: Number.isFinite(targetValue) ? targetValue : pertMean,
            randomSeed: randomSeed, adaptive: true, probeLevel: probeLevel,
            seedSliders: seedBest ? seedBest.sliders01 : null
          });
        }

        var optRes = adaptive ? (adaptiveRes || fixedRes) : fixedRes;

        if (!optRes || optRes.error) {
          optimizeBlock = { status: 'error', reasonCode: 'optimize_failed', message: (optRes && optRes.error) || 'Unknown optimizer error' };
        } else {
          /* Normalize slider blocks */
          var slidersUiOpt = (optRes && optRes.scaledSliders) || null;
          var sliders01Opt = (optRes && (optRes.sliders01 || optRes.sliders)) || null;

          if (!slidersUiOpt) {
            var picked01 = pickOptimizedSliders(optRes);
            if (picked01 && Object.keys(picked01).length) {
              slidersUiOpt = {
                budgetFlexibility:       (picked01.budgetFlexibility       || 0) * 100,
                scheduleFlexibility:     (picked01.scheduleFlexibility     || 0) * 100,
                scopeCertainty:          (picked01.scopeCertainty          || 0) * 100,
                scopeReductionAllowance: (picked01.scopeReductionAllowance || 0) * 100,
                reworkPercentage:        (picked01.reworkPercentage        || 0) * 50,
                riskTolerance:           (picked01.riskTolerance           || 0) * 100,
                userConfidence:          (picked01.userConfidence          || 0) * 100
              };
            } else {
              slidersUiOpt = { budgetFlexibility: 0, scheduleFlexibility: 0, scopeCertainty: 0, scopeReductionAllowance: 0, reworkPercentage: 0, riskTolerance: 0, userConfidence: 0 };
            }
          }
          if (!sliders01Opt) sliders01Opt = to01FromUi(slidersUiOpt);

          var reshaped = (optRes && optRes.reshapedPoints) || null;
          var optPdf   = asPointsArray(reshaped && reshaped.pdfPoints);
          var optCdf   = asPointsArray(reshaped && reshaped.cdfPoints);

          var adjProb = Number(optRes && optRes.finalProb);
          if (!Number.isFinite(adjProb)) adjProb = Number(optRes && optRes.optimizedResult && optRes.optimizedResult.probability && optRes.optimizedResult.probability.value);

          var baseProbSameTarget = hasTarget ? coercePercent01(typeof interpCdf(cdf, targetValue) === 'object' ? interpCdf(cdf, targetValue).value : interpCdf(cdf, targetValue)) : 0.5;
          var finalProbSafe = Number.isFinite(adjProb) ? adjProb : baseProbSameTarget;
          var sensitivityChange = finalProbSafe - baseProbSameTarget;

          /* Fallback points if optimizer gave nothing (revert case) */
          if ((!optPdf.length || !optCdf.length) && slidersUiOpt) {
            optPdf = pdf.slice(); optCdf = cdf.slice();
          }

          /* Enrich explain block */
          var optExplain = optRes && optRes.explain;
          var baseAtSameTarget = hasTarget ? coercePercent01(typeof interpCdf(cdf, targetValue) === 'object' ? interpCdf(cdf, targetValue).value : interpCdf(cdf, targetValue)) : 0.5;
          if (optExplain) {
            if (!Number.isFinite(optExplain.baselineProb)) optExplain.baselineProb = baseAtSameTarget;
            if (!Number.isFinite(optExplain.finalProb))    optExplain.finalProb    = adjProb;
            if (!optExplain.mode) optExplain.mode = adaptive ? 'saco-adaptive' : 'saco-fixed';
            if (optExplain.probeLevel === undefined) optExplain.probeLevel = probeLevel;
            if (adaptive && seedBest) {
              optExplain.seedBest = seedBest;
              if (Number.isFinite(seedBest.finalProb) && Number.isFinite(adjProb)) {
                optExplain.chainingDrift = Math.abs((adjProb - seedBest.finalProb) / seedBest.finalProb) * 100;
              }
            }
          } else {
            optExplain = {
              baselineProb: baseAtSameTarget, finalProb: adjProb,
              narrative: 'Optimization completed.',
              mode: adaptive ? 'saco-adaptive' : 'saco-fixed',
              probeLevel: probeLevel, sliders: [],
              winningSliders: slidersUiOpt || {}
            };
            if (adaptive && seedBest && Number.isFinite(seedBest.finalProb) && Number.isFinite(adjProb)) {
              optExplain.seedBest = seedBest;
              optExplain.chainingDrift = Math.abs((adjProb - seedBest.finalProb) / seedBest.finalProb) * 100;
            }
            if (optRes) optRes.explain = optExplain;
          }

          optimizeBlock = {
            status: (optRes && optRes.status) || 'ok',
            sliders:     slidersUiOpt || {},
            scaledSliders: slidersUiOpt || {},
            sliders01:   sliders01Opt || {},
            probabilityAtTarget: { value: Number.isFinite(adjProb) ? adjProb : finalProbSafe },
            reshapedPoints: { pdfPoints: clipPoints(optPdf || pdf), cdfPoints: clipPoints(optCdf || cdf) },
            metrics: { sensitivityChange: sensitivityChange },
            explain: optExplain,
            certificate: (optRes && typeof optRes.certificate === 'string') ? optRes.certificate : undefined
          };

          tp_adjustedOptimized = adjProb;
          tp_adaptiveOptimized = adaptive ? adjProb : undefined;
        }
      }

      /* Manual-only mode (probeLevel === 0) */
      if (probeLevel === 0) {
        var manualPdf = (adjustedBlock.reshapedPoints && adjustedBlock.reshapedPoints.pdfPoints) || pdf;
        var manualCdf = (adjustedBlock.reshapedPoints && adjustedBlock.reshapedPoints.cdfPoints) || cdf;
        var manual01  = to01FromUi(slidersUi);
        manualOptimizeBlock = {
          status: 'manual',
          sliders: Object.assign({}, slidersUi),
          sliders01: manual01,
          scaledSliders: Object.assign({}, slidersUi),
          reshapedPoints: { pdfPoints: clipPoints(manualPdf), cdfPoints: clipPoints(manualCdf) },
          explain: Object.assign({}, (adjustedBlock.explain || {}), {
            narrative: (adjustedBlock.explain && adjustedBlock.explain.narrative) || 'Manual mode: User sliders applied via SACO reshape.',
            probeLevel: 0
          })
        };
        if (hasTarget) {
          var pManual = (adjustedBlock.probabilityAtTarget && adjustedBlock.probabilityAtTarget.value) != null
            ? adjustedBlock.probabilityAtTarget.value : baseProb;
          tp_adjustedOptimized = pManual;
          tp_adaptiveOptimized = adaptive ? pManual : undefined;
        }
      }

      /* ---------------------------------------------------------------- */
      /* Build response envelope                                          */
      /* ---------------------------------------------------------------- */
      var finalOptBlock = manualOptimizeBlock || optimizeBlock;

      var response = {
        schemaVersion: SCHEMA_VERSION,
        buildInfo:     { tag: BUILD_TAG, builtAt: new Date().toISOString() },
        taskEcho: {
          task: taskName, optimistic: optimistic, mostLikely: mostLikely, pessimistic: pessimistic,
          targetValue: targetValue, confidenceLevel: confidenceLevel,
          randomSeed: randomSeed, adaptive: adaptive, probeLevel: probeLevel
        },
        flags: { allZeroPassThrough: allZeroPassThrough, hasTarget: hasTarget },
        baseline: {
          status: 'ok',
          pert:                { value: Number.isFinite(pertMean) ? pertMean : undefined },
          probabilityAtTarget: { value: hasTarget ? baseProb : undefined },
          probabilityAtPert:   { value: baseProbAtPert },
          monteCarloSmoothed:  { pdfPoints: clipPoints(pdf), cdfPoints: clipPoints(cdf) },
          metrics: {
            monteCarloSmoothed: { ci: { lower: ciLower, upper: ciUpper } },
            klDivergenceToTriangle: Number.isFinite(klToTriangle) ? klToTriangle : undefined
          }
        },
        trianglePdf:   { value: clipPoints(trianglePdfPts) },
        triangleCdf:   { value: clipPoints(triangleCdfPts) },
        betaPertPdf:   { value: clipPoints(betaPertPdfPts) },
        betaPertCdf:   { value: clipPoints(betaPertCdfPts) },
        adjusted:      adjustedBlock,
        optimize:      finalOptBlock,
        optimalSliderSettings: finalOptBlock.sliders ? { value: finalOptBlock.sliders } : { value: {} },
        debugPresence: {
          baseline: { pdf: Array.isArray(pdf) && pdf.length > 0, cdf: Array.isArray(cdf) && cdf.length > 0 },
          optimized: {
            sliders: !!(finalOptBlock.sliders && Object.keys(finalOptBlock.sliders).length > 0),
            pdf: Array.isArray(finalOptBlock.reshapedPoints && finalOptBlock.reshapedPoints.pdfPoints) && finalOptBlock.reshapedPoints.pdfPoints.length > 0,
            cdf: Array.isArray(finalOptBlock.reshapedPoints && finalOptBlock.reshapedPoints.cdfPoints) && finalOptBlock.reshapedPoints.cdfPoints.length > 0
          }
        }
      };

      /* Back-compat aggregates */
      response.allDistributions = {
        value: {
          monteCarloSmoothed: response.baseline.monteCarloSmoothed,
          triangle: trianglePdfPts.length ? { pdfPoints: clipPoints(trianglePdfPts), cdfPoints: clipPoints(triangleCdfPts) } : undefined,
          betaPert: betaPertPdfPts.length ? { pdfPoints: clipPoints(betaPertPdfPts), cdfPoints: clipPoints(betaPertCdfPts) } : undefined
        }
      };
      response.monteCarloSmoothed       = response.baseline.monteCarloSmoothed;
      response.monteCarloSmoothedPoints  = response.baseline.monteCarloSmoothed;
      response.pertMean                  = { value: response.baseline.pert.value };

      /* targetProbability mirrors */
      response.targetProbability = {
        value: {
          original:          baseProb,
          adjusted:          coalesce(adjustedBlock.probabilityAtTarget && adjustedBlock.probabilityAtTarget.value, baseProb),
          adjustedOptimized: coalesce(tp_adjustedOptimized, finalOptBlock.probabilityAtTarget && finalOptBlock.probabilityAtTarget.value, baseProb),
          adaptiveOptimized: coalesce(tp_adaptiveOptimized, adaptive ? (finalOptBlock.probabilityAtTarget && finalOptBlock.probabilityAtTarget.value) : undefined)
        }
      };

      /* Points mirrors */
      var adjPdfOut = allZeroPassThrough ? pdf : asPointsArray((adjustedBlock.reshapedPoints && adjustedBlock.reshapedPoints.pdfPoints) || pdf);
      var adjCdfOut = allZeroPassThrough ? cdf : asPointsArray((adjustedBlock.reshapedPoints && adjustedBlock.reshapedPoints.cdfPoints) || cdf);
      var optPdfOut = asPointsArray(finalOptBlock.reshapedPoints && finalOptBlock.reshapedPoints.pdfPoints);
      var optCdfOut = asPointsArray(finalOptBlock.reshapedPoints && finalOptBlock.reshapedPoints.cdfPoints);

      response.targetProbabilityOriginalPdf = { value: pdf };
      response.targetProbabilityOriginalCdf = { value: cdf };
      response.targetProbabilityAdjustedPdf = { value: adjPdfOut };
      response.targetProbabilityAdjustedCdf = { value: adjCdfOut };
      response.optimizedReshapedPoints      = { pdfPoints: optPdfOut, cdfPoints: optCdfOut };

      response.explain = {
        adjusted:  (adjustedBlock.explain)  || null,
        optimized: (finalOptBlock.explain)  || null
      };
      if (adaptive && response.explain) {
        response.explain.adaptive = response.explain.optimized || null;
      }

      /* Decision reports array */
      var reportsArray = [];
      if (adjustedBlock.explain) {
        reportsArray.push(toReportEntry('Adjusted', hasTarget ? targetValue : mostLikely,
          adjustedBlock.explain.baselineProb, adjustedBlock.explain.finalProb, adjustedBlock.explain, null));
      }
      if (finalOptBlock.explain) {
        reportsArray.push(toReportEntry(
          finalOptBlock.status === 'manual' ? 'Manual' : 'Optimize',
          hasTarget ? targetValue : mostLikely,
          finalOptBlock.explain.baselineProb, finalOptBlock.explain.finalProb, finalOptBlock.explain, finalOptBlock.certificate || null));
      }
      response.decisionReports = reportsArray.filter(Boolean);

      return response;

    } catch (e) {
      var err = extractError(e);
      return {
        schemaVersion: SCHEMA_VERSION,
        buildInfo:     { tag: BUILD_TAG, builtAt: new Date().toISOString() },
        error: err.message, details: err.details
      };
    }
  }

  /* ------------------------------------------------------------------ */
  /* Adapter (ports adapter.gs)                                          */
  /* ------------------------------------------------------------------ */

  function adaptResponse(core) {
    if (!core || core.error) return core || { error: 'Unknown error' };

    var baseline  = core.baseline  || {};
    var optimized = core.optimize  || {};
    var adjusted  = core.adjusted  || {};
    var flags     = core.flags     || {};

    var adjustedExplain = (adjusted && typeof adjusted.explain === 'object') ? adjusted.explain : null;

    var rawManualSliders01 =
      (adjustedExplain && typeof adjustedExplain.manualSliders === 'object')
        ? adjustedExplain.manualSliders
        : (adjustedExplain && typeof adjustedExplain.winningSliders === 'object'
            ? adjustedExplain.winningSliders
            : null);

    var manualSliders01 = normalizeSliderBlock01(rawManualSliders01);

    var basePdf = asArray(baseline.monteCarloSmoothed && baseline.monteCarloSmoothed.pdfPoints);
    var baseCdf = asArray(baseline.monteCarloSmoothed && baseline.monteCarloSmoothed.cdfPoints);

    var zeroPass   = !!flags.allZeroPassThrough;
    var adjPdfRaw  = asArray(adjusted.reshapedPoints && adjusted.reshapedPoints.pdfPoints);
    var adjCdfRaw  = asArray(adjusted.reshapedPoints && adjusted.reshapedPoints.cdfPoints);
    var adjPdf     = zeroPass ? basePdf : adjPdfRaw;
    var adjCdf     = zeroPass ? baseCdf : adjCdfRaw;

    var optPdf = asArray(optimized.reshapedPoints && optimized.reshapedPoints.pdfPoints);
    var optCdf = asArray(optimized.reshapedPoints && optimized.reshapedPoints.cdfPoints);

    var tpOriginal        = asNum(baseline.probabilityAtTarget && baseline.probabilityAtTarget.value);
    var tpAdjustedManual  = zeroPass ? tpOriginal : asNum(adjusted.probabilityAtTarget && adjusted.probabilityAtTarget.value);
    var tpAdaptiveOpt     = coalesce(asNum(core.targetProbability && core.targetProbability.value && core.targetProbability.value.adaptiveOptimized), asNum(optimized.probabilityAtTarget && optimized.probabilityAtTarget.value));
    var tpAdjustedOpt     = coalesce(asNum(core.targetProbability && core.targetProbability.value && core.targetProbability.value.adjustedOptimized), asNum(optimized.probabilityAtTarget && optimized.probabilityAtTarget.value));
    var sensitivityChange = asNum(core.optimize && core.optimize.metrics && core.optimize.metrics.sensitivityChange);

    var normSliders       = normalizeSliderBlock01(optimized.sliders);
    var normScaledSliders = normalizeSliderBlock01(optimized.scaledSliders || optimized.sliders);

    /* Build output (spread core, then override key fields) */
    var out = Object.assign({}, core);
    out.flags = Object.assign({}, flags);
    out.baseline = Object.assign({}, baseline, { monteCarloSmoothed: { pdfPoints: basePdf, cdfPoints: baseCdf } });
    out.adjusted = Object.assign({}, adjusted, {
      reshapedPoints: { pdfPoints: adjPdf, cdfPoints: adjCdf },
      probabilityAtTarget: { value: tpAdjustedManual },
      manualSliders01: manualSliders01 || null
    });
    out.optimize = Object.assign({}, optimized, {
      reshapedPoints: { pdfPoints: optPdf, cdfPoints: optCdf },
      sliders: normSliders,
      scaledSliders: normScaledSliders
    });
    out.targetProbability = {
      value: {
        original:          tpOriginal,
        adjusted:          coalesce(tpAdjustedManual, tpOriginal),
        adjustedOptimized: coalesce(tpAdjustedOpt, tpAdjustedManual, tpOriginal),
        adaptiveOptimized: tpAdaptiveOpt
      }
    };
    out.trianglePdf  = { value: asArray(core.trianglePdf && core.trianglePdf.value) };
    out.triangleCdf  = { value: asArray(core.triangleCdf && core.triangleCdf.value) };
    out.betaPertPdf  = { value: asArray(core.betaPertPdf && core.betaPertPdf.value) };
    out.betaPertCdf  = { value: asArray(core.betaPertCdf && core.betaPertCdf.value) };
    out.targetProbabilityOriginalPdf = { value: basePdf };
    out.targetProbabilityOriginalCdf = { value: baseCdf };
    out.targetProbabilityAdjustedPdf = { value: adjPdf };
    out.targetProbabilityAdjustedCdf = { value: adjCdf };
    out.optimizedReshapedPoints = { pdfPoints: optPdf, cdfPoints: optCdf };
    out.decisionReports         = Array.isArray(core.decisionReports) ? core.decisionReports : null;
    out.mcSmoothedSensitivityChange = sensitivityChange;

    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Public API                                                          */
  /* ------------------------------------------------------------------ */

  /**
   * Run a single estimation task.
   * @param {object} task  Task params (optimistic, mostLikely, pessimistic, targetValue, …)
   * @returns {object}  Full response envelope
   */
  function run(task) {
    var raw = processTask(task);
    return adaptResponse(raw);
  }

  /**
   * Run multiple tasks in sequence.
   * @param {object[]} tasks
   * @returns {{ results: object[], error: string|null, feedbackMessages: string[] }}
   */
  function runAll(tasks) {
    try {
      if (!Array.isArray(tasks) || tasks.length === 0) throw new Error('Tasks must be a non-empty array');
      var results = [], feedback = [];
      for (var i = 0; i < tasks.length; i++) {
        var r = run(tasks[i]);
        results.push(r);
        if (r && r.error) feedback.push('Failed task ' + (tasks[i].task || i) + ': ' + r.error);
      }
      return { results: results, error: null, details: {}, feedbackMessages: feedback };
    } catch (e) {
      var err = extractError(e);
      return { results: [], error: err.message, details: err.details, feedbackMessages: [err.message] };
    }
  }

  var PMCSACO = {
    /* Entry points */
    run:          run,
    runAll:       runAll,

    /* Exposed utilities for app.js */
    to01FromUi:   to01FromUi,
    adaptResponse: adaptResponse,
    toReportEntry: toReportEntry,
    SCHEMA_VERSION: SCHEMA_VERSION
  };

  root.PMCSACO = PMCSACO;

})(typeof window !== 'undefined' ? window : this);
