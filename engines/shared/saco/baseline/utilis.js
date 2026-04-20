// Ported from system-google-sheets-addon/core/baseline/utilis.gs
//'use strict';

/**
 * core/baseline/utils.js — Shared baseline utilities for Monte Carlo generation and metrics.
 * Extracted to break circular dependency between main.js and optimizer.js.
 *
 * Exports:
 * - generateMonteCarloBaseline(o, m, p, n=10000): Generates samples, PDF/CDF points.
 * - computeBaselineMetrics(baselineData, pertMean, targetValue, confidenceLevel=0.95): CI from samples, baseProb.
 */

 /**
 * Generates Monte Carlo samples for triangular distribution (O-M-P), then computes smoothed PDF/CDF points.
 * Used in baseline flows (optimize=false); input: optimistic (O), mostLikely (M), pessimistic (P); output: samples, binned PDF, empirical CDF.
 * @param {number} o - Optimistic estimate.
 * @param {number} m - Most likely estimate.
 * @param {number} p - Pessimistic estimate.
 * @param {number} [n=10000] - Number of samples.
 * @returns {{ pdfPoints: Array<{x:number,y:number}>, cdfPoints: Array<{x:number,y:number}>, samples: number[] }}
 */
function generateMonteCarloBaseline(o, m, p, n=10000) {
  // Validate inputs implicitly via finite checks in caller
  const samples = [];
  const fc = p - o;  // Full range (P - O)
  const f1 = (m - o) / fc;  // Cumulative fraction to mode (M)

  // Sample n points using inverse CDF method for triangular dist
  for (let i = 0; i < n; i++) {
    const u = Math.random();  // Uniform [0,1)
    let r;
    if (u < f1) {
      // Left side (O to M): rising density
      r = o + Math.sqrt(u * fc * (m - o));
    } else {
      // Right side (M to P): falling density
      r = p - Math.sqrt((1 - u) * fc * (p - m));
    }
    samples.push(r);
  }

  // Sort samples for CDF and binning
  samples.sort((a, b) => a - b);
  const minX = samples[0];
  const maxX = samples[samples.length - 1];
  const bins = Math.max(20, Math.floor((maxX - minX) / 5));  // Adaptive bins (~5-unit width min)
  const binWidth = (maxX - minX) / bins;
  const hist = new Array(bins).fill(0);

  // Bin samples for PDF (histogram density)
  for (const s of samples) {
    const binIdx = Math.min(bins - 1, Math.max(0, Math.floor((s - minX) / binWidth)));
    hist[binIdx]++;
  }

  // PDF points: Mid-bin x, normalized density y = count / (n * width)
  const pdfPoints = hist.map((count, i) => {
    const x = minX + (i + 0.5) * binWidth;
    const y = count / (n * binWidth);
    return { x, y };
  });

  // CDF points: Empirical from sorted samples (x=sample, y=rank/n)
  const cdfPoints = samples.map((s, i) => ({ x: s, y: i / n }));

  return {
    pdfPoints,    // Array of {x,y} for density plot
    cdfPoints,    // Array of {x,y} for cumulative plot
    samples       // Raw sorted samples (for CI computation)
  };
}

/**
 * Computes confidence interval (CI) and base probability from Monte Carlo samples.
 * Input: baselineData (from generateMonteCarloBaseline), pertMean (weighted mean), targetValue (optional), confidenceLevel (default 0.95).
 * Output: CI nested under monteCarloSmoothed (matches parser expectation), baseProb.
 * @param {{samples: number[]}} baselineData - Output from generateMonteCarloBaseline.
 * @param {number} pertMean - PERT mean for reference.
 * @param {number} [targetValue] - Optional target for baseProb.
 * @param {number} [confidenceLevel=0.95] - CI level.
 * @returns {{ ci: { monteCarloSmoothed: { lower: number, upper: number, confidenceLevel: number } }, baseProb: number | undefined }}
 */
function computeBaselineMetrics(baselineData, pertMean, targetValue, confidenceLevel = 0.95) {
  const { samples } = baselineData;
  const n = samples.length;
  const alpha = (1 - confidenceLevel) / 2;  // Two-tailed alpha

  // Percentile indices for CI bounds (floor for lower, ceil-1 for upper)
  const lowIdx = Math.floor(n * alpha);
  const highIdx = Math.ceil(n * (1 - alpha)) - 1;

  const ciLower = samples[lowIdx];
  const ciUpper = samples[highIdx];

  // Debug log — remove later if not needed
  console.log(`computeBaselineMetrics: CI calculated — lower=${ciLower}, upper=${ciUpper}, confidenceLevel=${confidenceLevel}, n_samples=${n}`);

  const ci = {
    lower: ciLower,
    upper: ciUpper,
    confidenceLevel
  };

  // Base probability: Fraction of samples <= target (empirical CDF at target)
  let baseProb = undefined;
  if (targetValue !== undefined && Number.isFinite(targetValue)) {
    const below = samples.filter(s => s <= targetValue).length / n;
    baseProb = below;
  }

  return {
    ci: {
      monteCarloSmoothed: ci  // Nested exactly as parseBaseline_ expects
    },
    baseProb  // Undefined if no target
  };
}

// Export (Apps Script global — no module.exports needed)
