// Ported from system-google-sheets-addon/core/optimization/kl-divergence.gs
// File: optimization/kl-divergence.gs
// Compute KL divergence between two PDFs using a shared grid. v1.9.24
// Cleaned for pure Apps Script - global scope, no Node.js

// trapezoidArea and renormalizePdf defined in optimizer.js (shared global scope)

function computeKLDivergence(params) {
  try {
    const { distributions, task } = params;
    if (!distributions || typeof distributions !== 'object') {
      throw createErrorResponse('Invalid distributions');
    }
    if (!distributions.triangle?.pdfPoints || !distributions.monteCarloSmoothed?.pdfPoints) {
      throw createErrorResponse('Missing distribution points');
    }
    if (!task || typeof task !== 'string') {
      throw createErrorResponse('Invalid task name');
    }

    validateDistributionInputs({
      triangle: distributions.triangle.pdfPoints,
      monteCarloSmoothed: distributions.monteCarloSmoothed.pdfPoints
    });

    // Align both PDFs onto the same x-grid [Step 6: Common grid for trap ∫ log(p/q) dx <0.05; chaining no align drift]
    let [P, Q] = alignPoints(distributions.triangle.pdfPoints, distributions.monteCarloSmoothed.pdfPoints);

    // Renormalize defensively [Math: Ensures ∫=1 pre-log for KL<0.05 tie]
    renormalizePdf(P);
    renormalizePdf(Q);

    const EPS = 1e-12;

    // Trapezoidal integration of p(x) * log(p(x)/q(x)) [PMBOK Ch.6: Quant penalty exp(-KL) in score]
    let kl = 0;
    for (let i = 1; i < P.length; i++) {
      const dx = P[i].x - P[i - 1].x;
      if (!Number.isFinite(dx) || dx <= 0) continue;

      const p0 = Math.max(P[i - 1].y, EPS), p1 = Math.max(P[i].y, EPS);
      const q0 = Math.max(Q[i - 1].y, EPS), q1 = Math.max(Q[i].y, EPS);

      const f0 = p0 * Math.log(p0 / q0);
      const f1 = p1 * Math.log(p1 / q1);

      kl += 0.5 * (f0 + f1) * dx;
    }

    if (!Number.isFinite(kl) || kl < 0) {
      // Numerical noise can make it slightly negative; clamp to 0 rather than throw.
      kl = Math.max(0, kl);
    }

    return { 'triangle-monteCarloSmoothed': kl };
  } catch (error) {
    return createErrorResponse(`Failed to compute KL divergence: ${error.message || 'Unknown error'}`);
  }
}
