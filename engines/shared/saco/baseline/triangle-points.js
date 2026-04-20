// Ported from system-google-sheets-addon/core/baseline/triangle-points.gs
//'use strict';

//var jstat = require('jstat');

/**
 * Generates triangle distribution PDF and CDF points. v1.9.24
 * @param {Object} params
 * @param {number} params.optimistic
 * @param {number} params.mostLikely
 * @param {number} params.pessimistic
 * @param {number} [params.numSamples=200]
 * @returns {{pdfPoints:Array<{x:number,y:number}>, cdfPoints:Array<{x:number,y:number}>}|{pdfPoints:[],cdfPoints:[],error:string}}
 * SACO Step 1: Triangle pdf/cdf as baseline for KL(Triangle||MC)<0.05 (Step 6 tie); linear pdf for ROM rough scout (Ch.11).
 * Math: Height=2/range for ∫=1; renormalize trap for numeric drift; monotone cdf for interp fidelity.
 */
function generateTrianglePoints({ optimistic, mostLikely, pessimistic, numSamples = 200 }) {
  console.log('generateTrianglePoints: Starting', { optimistic, mostLikely, pessimistic, numSamples });
  try {
    if (!Number.isFinite(optimistic) || !Number.isFinite(mostLikely) || !Number.isFinite(pessimistic)) {
      throw new Error('Invalid estimates: must be finite numbers');
    }
    if (optimistic > mostLikely || mostLikely > pessimistic) {
      throw new Error('Estimates must satisfy optimistic <= mostLikely <= pessimistic');
    }
    if (pessimistic - optimistic <= 0) throw new Error('Degenerate case: single point distribution');
    if (!Number.isFinite(numSamples) || numSamples < 2) throw new Error('Invalid numSamples: must be a number >= 2');

    const range = pessimistic - optimistic;
    const step = range / (numSamples - 1);
    const height = 2 / range; // Peak height for area=1 [Math: Linear tent ∫=1 for KL baseline]
    const leftDenom = mostLikely - optimistic;
    const rightDenom = pessimistic - mostLikely;
    const pdfPoints = [];
    for (let i = 0; i < numSamples; i++) {
      const x = optimistic + i * step;
      let y = 0;
      if (x >= optimistic && x <= mostLikely) {
        if (leftDenom > 0) {
          y = height * (x - optimistic) / leftDenom;
        } else {
          // Degenerate left: flat at peak if x == mostLikely, but for simplicity, set to 0 (point mass ignored in continuous)
          y = 0;
        }
      } else if (x > mostLikely && x <= pessimistic) {
        if (rightDenom > 0) {
          y = height * (pessimistic - x) / rightDenom;
        } else {
          // Degenerate right: flat at 0
          y = 0;
        }
      }
      if (!Number.isFinite(y)) throw new Error('Invalid PDF value', { x, y });
      pdfPoints.push({ x, y });
    }

    // Normalize PDF [Step 1: Trap ∫=1 for KL(T||MC); Ch.6 quant invariant]
    let area = 0;
    for (let i = 1; i < pdfPoints.length; i++) {
      const dx = pdfPoints[i].x - pdfPoints[i - 1].x;
      if (!Number.isFinite(dx) || dx <= 0) throw new Error('Invalid dx in normalization', { dx, i });
      area += (pdfPoints[i].y + pdfPoints[i - 1].y) / 2 * dx;
    }
    if (!Number.isFinite(area) || area <= 0) throw new Error('Invalid PDF sum before normalization');
    const normPdf = pdfPoints.map(p => ({ x: p.x, y: p.y / area }));

    // Build CDF (same length as PDF) [Math: Cum trap monotone for Step 5 P'(τ); Ch.11 hygiene no drift]
    const cdfPoints = [];
    let cum = 0;
    for (let i = 0; i < normPdf.length; i++) {
      if (i === 0) {
        cdfPoints.push({ x: normPdf[i].x, y: 0 });
      } else {
        const dx = normPdf[i].x - normPdf[i - 1].x;
        if (!Number.isFinite(dx) || dx <= 0) throw new Error('Invalid dx in CDF computation', { dx, i });
        cum += (normPdf[i].y + normPdf[i - 1].y) / 2 * dx;
        cdfPoints.push({ x: normPdf[i].x, y: Math.min(Math.max(cum, 0), 1) });
      }
    }

    console.log('generateTrianglePoints: Completed', {
      pdfPointsLength: normPdf.length, cdfPointsLength: cdfPoints.length
    });
    return { pdfPoints: normPdf, cdfPoints };
  } catch (error) {
    console.error('generateTrianglePoints: Error', { message: error.message, stack: error.stack });
    return { pdfPoints: [], cdfPoints: [], error: error.message };
  }
}

//module.exports = { generateTrianglePoints };
