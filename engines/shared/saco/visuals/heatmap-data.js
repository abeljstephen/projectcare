// Ported from system-google-sheets-addon/core/visuals/heatmap-data.gs
// File: visuals/heatmap-data.gs
// Build heatmap-ready matrices: correlationMatrix and interactionsMatrix
// Cleaned for pure Apps Script - global scope, no Node.js

/**
 * Build heatmap-ready matrices:
 *  - correlationMatrix: 7x7 from domain BASE_R (fallback to identity)
 *  - interactionsMatrix: 7x7 from sensitivity change outer-product (fallback to zeros or correlation)
 *
 * @param {Object} args
 * @param {string[]} args.labels - canonical slider labels (length 7)
 * @param {number[][]|null} args.baseCorrelation - 7x7 matrix (optional)
 * @param {Object|null} args.sensitivityChange - map { sliderName: number } of dP/ds
 * @returns {{ labels:string[], correlationMatrix:number[][], interactionsMatrix:number[][] }}
 */
function buildHeatmapData({ labels, baseCorrelation, sensitivityChange }) {
  const L = Array.isArray(labels) && labels.length ? labels.slice() : [
    'budgetFlexibility','scheduleFlexibility','scopeCertainty',
    'scopeReductionAllowance','reworkPercentage','riskTolerance','userConfidence'
  ];
  const n = L.length;

  // correlationMatrix
  let C;
  if (Array.isArray(baseCorrelation) && baseCorrelation.length === n) {
    C = baseCorrelation.map(row => (Array.isArray(row) ? row.slice() : Array(n).fill(0)));
  } else {
    // identity fallback
    C = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (__, j) => (i === j ? 1 : 0))
    );
  }

  // interactionsMatrix from sensitivities
  let M = Array.from({ length: n }, () => Array(n).fill(0));
  if (sensitivityChange && typeof sensitivityChange === 'object') {
    const v = L.map(k => Number(sensitivityChange[k] || 0));
    const maxAbs = Math.max(1e-12, ...v.map(x => Math.abs(x)));
    const scale = 1 / maxAbs; // normalize to [-1..1]-ish
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const val = 0.5 * ((v[i] * v[j]) + (v[j] * v[i])); // symmetric outer (redundant but explicit)
        M[i][j] = Number.isFinite(val) ? Math.max(-1, Math.min(1, val * scale)) : 0;
      }
    }
  } else {
    // If no sensitivity, use a conservative, neutral matrix (zeros)
    M = Array.from({ length: n }, () => Array(n).fill(0));
  }

  return { labels: L, correlationMatrix: C, interactionsMatrix: M };
}
