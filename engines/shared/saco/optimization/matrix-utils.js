// Ported from system-google-sheets-addon/core/optimization/matrix-utils.gs
// File: optimization/matrix-utils.gs
// Small helpers for distribution validation & alignment. v1.9.24
// Cleaned for pure Apps Script - global scope, no Node.js

function generateUniquePairs(distNames) {
  if (!Array.isArray(distNames) || distNames.length < 2) {
    throw createErrorResponse('distNames must have at least 2 elements');
  }
  const pairs = [];
  for (let i = 0; i < distNames.length; i++) {
    for (let j = i + 1; j < distNames.length; j++) {
      pairs.push(`${distNames[i]}-${distNames[j]}`);
    }
  }
  return pairs;
}

function validateDistributionInputs(distributions, isCdf = false) {
  if (!distributions || Object.keys(distributions).length === 0) {
    throw createErrorResponse('Invalid distributions');
  }
  for (const [, points] of Object.entries(distributions)) {
    const ok = isCdf ? isValidCdfArray(points) : isValidPdfArray(points);
    if (!ok) throw createErrorResponse('Invalid points for distribution');
  }
  return true;
}

function alignPoints(p, q) {
  if (!isValidPdfArray(p) || !isValidPdfArray(q)) {
    throw createErrorResponse('Invalid point arrays');
  }

  const xMin = Math.min(p[0].x, q[0].x);
  const xMax = Math.max(p[p.length - 1].x, q[q.length - 1].x);

  // Try to infer a sane step; guard against zero/NaN [Step 6: Robust grid for trap KL; chaining no zero-step drift]
  const dp = p.length > 1 ? (p[1].x - p[0].x) : NaN;
  const dq = q.length > 1 ? (q[1].x - q[0].x) : NaN;
  const candidates = [dp, dq].filter(v => Number.isFinite(v) && v > 0);
  let step = candidates.length ? Math.min(...candidates) / 2 : NaN;
  if (!Number.isFinite(step) || step <= 0) {
    const maxLen = Math.max(2, Math.max(p.length, q.length));
    const span = Math.max(1e-9, xMax - xMin);
    step = span / (maxLen - 1);
  }

  const n = Math.max(2, Math.ceil((xMax - xMin) / step) + 1);
  const newX = Array.from({ length: n }, (_, i) => xMin + i * step);

  const lerp = (A, x) => {
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

  const alignedP = newX.map(x => ({ x, y: lerp(p, x) }));
  const alignedQ = newX.map(x => ({ x, y: lerp(q, x) }));
  return [alignedP, alignedQ];
}
