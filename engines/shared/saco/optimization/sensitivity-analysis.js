// Ported from system-google-sheets-addon/core/optimization/sensitivity-analysis.gs
// File: optimization/sensitivity-analysis.gs
// Finite-difference sensitivity of P(target) to each slider near current s. v1.9.24
// Cleaned for pure Apps Script - global scope, no Node.js

async function computeSensitivity(params) {
  try {
    const {
      originalPoints, targetValue,
      optimistic, mostLikely, pessimistic,
      sliderValues
    } = params;

    if (!originalPoints || !isValidPdfArray(originalPoints.pdfPoints) || !isValidCdfArray(originalPoints.cdfPoints)) {
      throw createErrorResponse('Invalid originalPoints: must include valid pdfPoints and cdfPoints arrays');
    }
    if (![optimistic, mostLikely, pessimistic, targetValue].every(Number.isFinite)) {
      throw createErrorResponse('Invalid numeric inputs');
    }
    if (optimistic > mostLikely || mostLikely > pessimistic) {
      throw createErrorResponse('Estimates must satisfy optimistic <= mostLikely <= pessimistic');
    }
    if (typeof sliderValues !== 'object') {
      throw createErrorResponse('Invalid sliderValues');
    }
    const v = validateSliders(sliderValues);
    if (!v.valid) throw createErrorResponse(v.message, { sliderValues });

    const baseRes = await probabilityAtTargetFast({
      points: originalPoints, optimistic, mostLikely, pessimistic, targetValue, sliderValues
    }, true);
    if (baseRes.error || !Number.isFinite(baseRes.probability?.value)) {
      throw createErrorResponse(`Failed to compute baseline probability: ${baseRes.error || 'Invalid value'}`);
    }
    const baselineProbability = baseRes.probability.value;

    const keys = ['budgetFlexibility','scheduleFlexibility','scopeCertainty','scopeReductionAllowance','reworkPercentage','riskTolerance','userConfidence'];
    const h = 2; // slider points
    const sensitivity = {};
    for (const k of keys) {
      const minV = 0, maxV = (k === 'reworkPercentage') ? 50 : 100;
      const right = Math.min(maxV, (sliderValues[k] ?? 0) + h);
      const pert = { ...sliderValues, [k]: right };
      const r = await probabilityAtTargetFast({
        points: originalPoints, optimistic, mostLikely, pessimistic, targetValue, sliderValues: pert
      }, true);
      if (r.error || !Number.isFinite(r.probability?.value)) {
        throw createErrorResponse(`Failed to compute perturbed probability for ${k}: ${r.error || 'Invalid value'}`);
      }
      const denom = (right - (sliderValues[k] ?? 0)) || 1;
      sensitivity[k] = (r.probability.value - baselineProbability) / denom;
    }

    // Build an interactions matrix (outer-product of changes) for heatmap;
    // normalized & symmetrized; safe defaults if anything is missing.
    const labels = SLIDER_KEYS.slice(); // SLIDER_KEYS assumed global
    const S = labels.map(k => Number(sensitivity[k] || 0));
    const n = labels.length;
    const interactionsMatrix = [];
    // Compute scale to keep numbers in a friendly range (basis: max abs)
    const maxAbs = Math.max(1e-12, ...S.map(v => Math.abs(v)));
    const scale = 1 / maxAbs; // so the largest becomes ~1
    for (let i = 0; i < n; i++) {
      const row = new Array(n).fill(0);
      for (let j = 0; j < n; j++) {
        const v = 0.5 * ((S[i] * S[j]) + (S[j] * S[i])); // symmetric outer
        row[j] = Number.isFinite(v) ? Math.max(-1, Math.min(1, v * scale)) : 0;
      }
      interactionsMatrix.push(row);
    }

    return {
      monteCarloSmoothed: {
        change: sensitivity
      },
      labels,
      interactionsMatrix
    };
  } catch (error) {
    throw createErrorResponse(`Failed to compute sensitivity: ${error.message || 'Unknown error'}`, { params });
  }
}
