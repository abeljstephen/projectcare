// Ported from system-google-sheets-addon/core/reshaping/slider-normalization.gs
// File: reshaping/slider-normalization.gs
// Normalize raw sliders to [0,1] influences and produce non-negative weights.
// Guarantees monotone mapping: higher slider -> higher influence.
// Provides a bounded "cap" for total lift control upstream.
// Cleaned for pure Apps Script - global scope, no Node.js

var DEFAULTS = {
  // Shape exponents per slider (>= 0.5 mild concave, >= 1 linear/convex)
  gamma: {
    budgetFlexibility: 1.0,
    scheduleFlexibility: 1.0,
    scopeCertainty: 1.0,
    scopeReductionAllowance: 1.0,
    reworkPercentage: 1.0,
    riskTolerance: 1.0,
    userConfidence: 1.0
  },
  // Non-negative weights for combining slider effects (relative importances)
  weights: {
    budgetFlexibility: 1.00,
    scheduleFlexibility: 0.90,
    scopeCertainty: 0.90,
    scopeReductionAllowance: 0.75,
    reworkPercentage: 0.70,
    riskTolerance: 0.60,
    userConfidence: 0.50
  },
  // Hard cap on overall lift proportion (used by caller)
  maxLiftScale: 0.50
};

function _sn_clamp01(x) { return Math.max(0, Math.min(1, Number(x))); }

/**
 * Map raw slider ∈ ℝ to normalized influence ∈ [0,1] with exponent gamma≥0.5.
 * Accepts s∈[0,100] or s∈[0,1]; normalizes to [0,1] first.
 */
function normalizeSlider(value, gamma = 1.0) {
  if (!Number.isFinite(value)) return 0;
  const v01 = value > 1 ? _sn_clamp01(value / 100) : _sn_clamp01(value);
  const g = Math.max(0.5, Number(gamma) || 1);
  return Math.pow(v01, g);
}

/**
 * Produce per-slider influences φ_i ∈ [0,1] and non-negative weights w_i (Σw_i=1).
 * If provided weights sum to 0, spreads evenly across known sliders.
 */
function normalizeAll(sliders = {}, config = {}) {
  const gamma = { ...DEFAULTS.gamma, ...(config.gamma || {}) };
  const rawWeights = { ...DEFAULTS.weights, ...(config.weights || {}) };

  // Ensure weights non-negative
  const weights = {};
  let wSum = 0;
  for (const k of Object.keys(rawWeights)) {
    const w = Math.max(0, Number(rawWeights[k]) || 0);
    weights[k] = w;
    wSum += w;
  }
  // Normalize to sum to 1 (or spread evenly if all zero)
  if (wSum > 0) {
    for (const k of Object.keys(weights)) weights[k] = weights[k] / wSum;
  } else {
    const keys = Object.keys(rawWeights);
    for (const k of keys) weights[k] = 1 / keys.length;
  }

  const phi = {
    budgetFlexibility: normalizeSlider(sliders.budgetFlexibility, gamma.budgetFlexibility),
    scheduleFlexibility: normalizeSlider(sliders.scheduleFlexibility, gamma.scheduleFlexibility),
    scopeCertainty: normalizeSlider(sliders.scopeCertainty, gamma.scopeCertainty),
    scopeReductionAllowance: normalizeSlider(sliders.scopeReductionAllowance, gamma.scopeReductionAllowance),
    reworkPercentage: normalizeSlider(sliders.reworkPercentage, gamma.reworkPercentage),
    riskTolerance: normalizeSlider(sliders.riskTolerance, gamma.riskTolerance),
    userConfidence: normalizeSlider(sliders.userConfidence, gamma.userConfidence)
  };

  return {
    phi,           // per-slider influences in [0,1]
    weights,       // non-negative, sum to 1
    maxLiftScale: Number.isFinite(config.maxLiftScale)
      ? Math.max(0, Math.min(1, config.maxLiftScale))
      : DEFAULTS.maxLiftScale
  };
}
