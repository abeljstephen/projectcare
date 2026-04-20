// Ported from system-google-sheets-addon/core/helpers/validation.gs
// File: helpers/validation.gs
// Minimal validation helpers (pure Apps Script - global)
// Force sync - Jan 16 2026 - Node.js removed, all functions global for local execution
// Update: cap reworkPercentage at 50 to match optimizer bounds (SACO domain-aware cap)

console.log('validation.js: Starting module initialization');

function validateEstimates(optimistic, mostLikely, pessimistic) {
  if (!Number.isFinite(optimistic) || !Number.isFinite(mostLikely) || !Number.isFinite(pessimistic)) {
    return { valid: false, message: 'Estimates must be finite numbers' };
  }
  if (optimistic > mostLikely || mostLikely > pessimistic) {
    return { valid: false, message: 'Estimates must satisfy optimistic <= mostLikely <= pessimistic' };
  }
  if (optimistic === pessimistic) {
    return { valid: false, message: 'Degenerate estimate: optimistic equals pessimistic — no distribution range' };
  }
  return { valid: true, message: '' };
}

function validateSliders(sliders) {
  if (!sliders || typeof sliders !== 'object') {
    return { valid: false, message: 'Sliders must be an object' };
  }
  const keys = ['budgetFlexibility', 'scheduleFlexibility', 'scopeCertainty', 'scopeReductionAllowance', 'reworkPercentage', 'riskTolerance', 'userConfidence'];
  for (const key of keys) {
    const max = key === 'reworkPercentage' ? 50 : 100; // SACO: Domain-aware cap (rework 0-50% UI for var-shrink)
    if (!(key in sliders) || !Number.isFinite(sliders[key]) || sliders[key] < 0 || sliders[key] > max) {
      return { valid: false, message: `Slider ${key} must be a number between 0 and ${max}` };
    }
  }
  return { valid: true, message: '' };
}

function isValidPdfArray(points) {
  if (!Array.isArray(points) || points.length < 2) return false;
  return points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y) && p.y >= 0);
}

function isValidCdfArray(points) {
  if (!Array.isArray(points) || points.length < 2) return false;
  return points.every((p, i) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.y >= 0 && p.y <= 1 && (i === 0 || p.y >= points[i-1].y));
}

function createErrorResponse(message, details = {}, originalError = null) {
  const errorMessage = message || (originalError && originalError.message) || 'Unknown error';
  const error = new Error(errorMessage);
  return {
    error: errorMessage,
    details: { ...details, originalMessage: message, originalError: originalError ? originalError.message : null },
    stack: originalError ? originalError.stack : error.stack
  };
}
