// Ported from system-google-sheets-addon/core/variable_map/adapter.gs
// File: variable_map/adapter.gs
// Adapter for response envelope: maps core outputs to UI/API schema.
// Cleaned for pure Apps Script - global scope, no Node.js

// ---------- helpers ----------
function _ad_asArray(x) {
  if (Array.isArray(x)) return x;
  if (x && Array.isArray(x.value)) return x.value;
  return [];
}

function asNum(x) {
  return (typeof x === 'number' && Number.isFinite(x)) ? x : undefined;
}

function coalesce(...vals) {
  for (const v of vals) {
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

// Normalize slider blocks to strict 0–1 domain (defensive against old % payloads)
function normalizeSliderBlock01(block) {
  if (!block || typeof block !== 'object') return null;
  const out = {};
  for (const [k, v] of Object.entries(block)) {
    let n = Number(v);
    if (!Number.isFinite(n)) continue;
    // If value is already 0–1, leave as-is.
    // If value looks like a %, map back to 0–1.
    if (n > 1) n = n / 100;
    if (n < 0) n = 0;
    if (n > 1) n = 1;
    out[k] = n;
  }
  return Object.keys(out).length ? out : null;
}

// Optional, best-effort visuals (guarded)
let visuals = null;

// Canonical slider keys & base correlations for fallbacks [Step 2: Grid %M scale via SLIDER_KEYS]
let copula = null;

function adaptResponse(core) {
  if (!core || core.error) return core || { error: 'Unknown error' };

  const baseline = core.baseline || {};
  const optimized = core.optimize || {};
  const adjusted  = core.adjusted || {};
  const flags     = core.flags || {};

  const adjustedExplain =
    adjusted && typeof adjusted.explain === 'object' ? adjusted.explain : null;

  // If manual path ran via computeSliderProbability, it should expose manualSliders
  // (raw 0–1 domain). Fallback to winningSliders if manualSliders not present.
  const rawManualSliders01 =
    (adjustedExplain && typeof adjustedExplain.manualSliders === 'object')
      ? adjustedExplain.manualSliders
      : (adjustedExplain && typeof adjustedExplain.winningSliders === 'object'
          ? adjustedExplain.winningSliders
          : null);

  const manualSliders01 = normalizeSliderBlock01(rawManualSliders01);

  // Baseline arrays
  const basePdf = _ad_asArray(baseline.monteCarloSmoothed?.pdfPoints);
  const baseCdf = _ad_asArray(baseline.monteCarloSmoothed?.cdfPoints);

  // Adjusted arrays (pass-through if all-zero)
  const zeroPass = !!flags.allZeroPassThrough;
  const adjPdfRaw = _ad_asArray(adjusted.reshapedPoints?.pdfPoints);
  const adjCdfRaw = _ad_asArray(adjusted.reshapedPoints?.cdfPoints);
  const adjPdf = zeroPass ? basePdf : adjPdfRaw;
  const adjCdf = zeroPass ? baseCdf : adjCdfRaw;

  // Optimized arrays
  const optPdf = _ad_asArray(optimized.reshapedPoints?.pdfPoints);
  const optCdf = _ad_asArray(optimized.reshapedPoints?.cdfPoints);

  // Probabilities
  const tpOriginal = asNum(baseline.probabilityAtTarget?.value);

  // Manual / adjusted probability:
  //  - If zeroPass, keep original; otherwise use adjusted.probabilityAtTarget.value
  const tpAdjustedManual = zeroPass
    ? tpOriginal
    : asNum(adjusted.probabilityAtTarget?.value);

  // Prefer explicit adaptive value if core exposed it; otherwise fall back to optimize.probabilityAtTarget
  const tpAdaptiveOptimized = coalesce(
    asNum(core.targetProbability?.value?.adaptiveOptimized),
    asNum(optimized.probabilityAtTarget?.value)
  );

  const tpAdjustedOptimized = coalesce(
    asNum(core.targetProbability?.value?.adjustedOptimized),
    asNum(optimized.probabilityAtTarget?.value)
  );

  // Sensitivity change convenience (for Phase-6 table)
  const mcSmoothedSensitivityChange = asNum(core.optimize?.metrics?.sensitivityChange);

  // Extract sliders from optimized (raw 0–1 domain; may be null if no optimization)
  const rawOptimizedSliders =
    (optimized && typeof optimized.sliders === 'object')
      ? optimized.sliders
      : null;

  const rawScaledSliders =
    (optimized && typeof optimized.scaledSliders === 'object')
      ? optimized.scaledSliders
      : null;

  // Enforce 0–1 normalized domain for both canonical slider fields
  const normSliders       = normalizeSliderBlock01(rawOptimizedSliders);
  const normScaledSliders = normalizeSliderBlock01(rawScaledSliders || rawOptimizedSliders);

  const out = {
    ...core,
    flags: { ...flags },

    baseline: {
      ...baseline,
      monteCarloSmoothed: { pdfPoints: basePdf, cdfPoints: baseCdf }
    },

    // Manual / adjusted path:
    //  - reshapedPoints / probabilityAtTarget from computeSliderProbability (SACO manual).
    //  - manualSliders01 exposed for UI slider state (raw 0–1; frontend handles %).
    //  - manualBenchmarkedProb: probability when user sliders are clamped to BENCH ceilings.
    adjusted: {
      ...adjusted,
      reshapedPoints: { pdfPoints: adjPdf, cdfPoints: adjCdf },
      probabilityAtTarget: { value: tpAdjustedManual },
      manualSliders01: manualSliders01 || null,
      manualBenchmarkedProb: asNum(adjusted.manualBenchmarkedProb) ?? null
    },

    // Optimized (fixed/adaptive) path:
    //  - sliders and scaledSliders are strict 0–1 blocks (no %).
    //  - Frontend handles all display scaling.
    optimize: {
      ...optimized,
      reshapedPoints: { pdfPoints: optPdf, cdfPoints: optCdf },
      sliders: normSliders,
      scaledSliders: normScaledSliders
    },

    targetProbability: {
      value: {
        original: tpOriginal,
        adjusted: (tpAdjustedManual ?? tpOriginal),
        adjustedOptimized: (tpAdjustedOptimized ?? tpAdjustedManual ?? tpOriginal),
        adaptiveOptimized: tpAdaptiveOptimized,
        manualBenchmarked: asNum(adjusted.manualBenchmarkedProb) ?? null
      }
    },

    trianglePdf:  { value: _ad_asArray(core.trianglePdf?.value) },
    triangleCdf:  { value: _ad_asArray(core.triangleCdf?.value) },
    betaPertPdf:  { value: _ad_asArray(core.betaPertPdf?.value) },
    betaPertCdf:  { value: _ad_asArray(core.betaPertCdf?.value) },

    targetProbabilityOriginalPdf: { value: basePdf },
    targetProbabilityOriginalCdf: { value: baseCdf },
    targetProbabilityAdjustedPdf: { value: adjPdf },
    targetProbabilityAdjustedCdf: { value: adjCdf },

    optimizedReshapedPoints: {
      pdfPoints: optPdf,
      cdfPoints: optCdf
    },

    // Reports passthrough + mirrors
    decisionReports: Array.isArray(core.decisionReports)
      ? core.decisionReports
      : (core.decisionReports || null),
    decisionCsv: core.decisionCsv ?? null,
    summaries: core.summaries ?? null,

    mcSmoothedSensitivityChange
  };

  // -----------------------------
  // Optional visuals [Step 7: Sankey/heatmap for chaining flow]
  // -----------------------------
  try {
    const labels =
      (copula && Array.isArray(copula.SLIDER_KEYS) && copula.SLIDER_KEYS.slice()) ||
      ['budgetFlexibility','scheduleFlexibility','scopeCertainty','scopeReductionAllowance','reworkPercentage','riskTolerance','userConfidence'];

    const baseCorrelation =
      (copula && Array.isArray(copula.BASE_R) && copula.BASE_R) || null;

    const sensObj =
      core?.sensitivity?.monteCarloSmoothed?.change ||
      core?.optimize?.metrics?.sensitivity?.monteCarloSmoothed?.change ||
      null;

    if (visuals && visuals.heatmap && labels) {
      const heat = visuals.heatmap.buildHeatmapData({
        labels,
        baseCorrelation,
        sensitivityChange: sensObj
      });
      out.sensitivity = Object.assign({}, out.sensitivity || {}, {
        labels: heat.labels,
        correlationMatrix: heat.correlationMatrix,
        interactionsMatrix: heat.interactionsMatrix
      });
    }

    if (visuals && visuals.sankey) {
      const pBase =  asNum(out?.targetProbability?.value?.original);
      const pAdj  =  asNum(out?.targetProbability?.value?.adjusted);
      const pOpt  =  asNum(out?.targetProbability?.value?.adjustedOptimized) ?? asNum(tpAdaptiveOptimized);
      const flow = visuals.sankey.buildSankeyFlow({ pBase, pAdjusted: pAdj, pOptimized: pOpt });
      out.progressionFlow = flow;
    }

    if (visuals && visuals.annotations) {
      const tau =
        asNum(core?.tau) ??
        asNum(core?.targetValue) ??
        asNum(core?.mostLikely);

      const series = {
        triangle: { pdf: _ad_asArray(out?.trianglePdf?.value),  cdf: _ad_asArray(out?.triangleCdf?.value) },
        betaPert: { pdf: _ad_asArray(out?.betaPertPdf?.value),  cdf: _ad_asArray(out?.betaPertCdf?.value) },
        baseline: { pdf: basePdf,                            cdf: baseCdf },
        adjusted: { pdf: adjPdf,                             cdf: adjCdf },
        optimized:{ pdf: optPdf,                             cdf: optCdf }
      };
      const ann = visuals.annotations.buildAnnotations({ tau, series });
      if (ann) out.annotations = ann;
    }
  } catch (e) {
    console.warn('adapter visuals build skipped:', e && e.message ? e.message : e);
  }

  // SACO v1.9.26:
  //  - chainingDrift (if present) is computed upstream in optimizer.js and
  //    attached to optimized.explain. We do NOT overwrite it here; UI can
  //    read out.optimize.explain.chainingDrift directly.

  return out;
}
