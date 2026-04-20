// Ported from system-google-sheets-addon/core/baseline/coordinator.gs
// baseline/coordinator.gs — Baseline generation (pure Apps Script - global)
// Force sync - Jan 16 2026 - Node.js removed
console.log('coordinator.js: Starting module initialization');

/**
 * Generates baseline distributions and metrics. v1.9.24 → v1.9.28 (added CI & KL surfacing)
 *
 * Policy:
 * - ALWAYS generate Triangle (needed for KL).
 * - Monte Carlo *smoothed* (active baseline) is always generated.
 * - If `suppressOtherDistros` is true: skip PERT/Beta/MC-raw (perf).
 * - All returned CDFs are hygiene-checked (sorted/monotone/clamped).
 * - NEW: Computes 95% CI using invertCdf on MC-smoothed CDF
 * - NEW: Attaches KL divergence to triangle in monteCarloSmoothed block
 */
function generateBaseline(params) {
  console.log('generateBaseline: Starting', { params });
  try {
    const {
      optimistic, mostLikely, pessimistic,
      numSamples = 200,
      suppressOtherDistros = false
    } = params;

    // Validation
    if (![optimistic, mostLikely, pessimistic].every(Number.isFinite)) {
      throw new Error('Invalid estimates: must be finite numbers');
    }
    if (!(optimistic <= mostLikely && mostLikely <= pessimistic)) {
      throw new Error('Estimates must satisfy optimistic <= mostLikely <= pessimistic');
    }
    if (!Number.isFinite(numSamples) || numSamples < 100) {
      throw new Error('Invalid numSamples: must be a number >= 100');
    }

    // Beta params (shared)
    const { alpha, beta } = computeBetaMoments({ optimistic, mostLikely, pessimistic });
    if (!(alpha > 0 && beta > 0 && Number.isFinite(alpha) && Number.isFinite(beta))) {
      throw new Error('Invalid beta parameters');
    }

    // Triangle (always)
    const trianglePoints = generateTrianglePoints({ optimistic, mostLikely, pessimistic, numSamples });
    if (trianglePoints.error ||
        !isValidPdfArray(trianglePoints.pdfPoints) ||
        !isValidCdfArray(trianglePoints.cdfPoints)) {
      throw new Error('Invalid triangle points');
    }
    trianglePoints.cdfPoints = ensureSortedMonotoneCdf(trianglePoints.cdfPoints);

    // Optionals (PERT/Beta/MC-raw)
    let pertPoints, betaPoints, monteCarloRawPoints;
    if (!suppressOtherDistros) {
      pertPoints = generatePertPoints({ optimistic, mostLikely, pessimistic, numSamples });
      if (pertPoints.error ||
          !isValidPdfArray(pertPoints.pdfPoints) ||
          !isValidCdfArray(pertPoints.cdfPoints)) {
        throw new Error('Invalid PERT points');
      }
      pertPoints.cdfPoints = ensureSortedMonotoneCdf(pertPoints.cdfPoints);

      betaPoints = generateBetaPoints({ optimistic, mostLikely, pessimistic, numSamples, alpha, beta });
      if (betaPoints.error ||
          !isValidPdfArray(betaPoints.pdfPoints) ||
          !isValidCdfArray(betaPoints.cdfPoints)) {
        throw new Error('Invalid beta points');
      }
      betaPoints.cdfPoints = ensureSortedMonotoneCdf(betaPoints.cdfPoints);

      monteCarloRawPoints = generateMonteCarloRawPoints({ optimistic, mostLikely, pessimistic, numSamples, alpha, beta });
      if (monteCarloRawPoints.error ||
          !isValidPdfArray(monteCarloRawPoints.pdfPoints) ||
          !isValidCdfArray(monteCarloRawPoints.cdfPoints)) {
        throw new Error('Invalid Monte Carlo raw points');
      }
      monteCarloRawPoints.cdfPoints = ensureSortedMonotoneCdf(monteCarloRawPoints.cdfPoints);
    } else {
      console.log('generateBaseline: suppressOtherDistros=true (PERT/Beta/MC-raw skipped; Triangle kept)');
    }

    // Monte Carlo smoothed (active baseline)
    // If priorHistory is provided and valid (n >= 1), use MH-MCMC with Student-t(ν=4) prior
    // (burn-in 500, thinning 5, 1000 effective chain samples).
    // Otherwise use standard i.i.d. Beta MC sampling. The downstream pipeline is identical.
    const smoothedParams = { optimistic, mostLikely, pessimistic, numSamples };
    if (monteCarloRawPoints?.samples?.length) smoothedParams.samples = monteCarloRawPoints.samples;
    const hasPriorHistory = params.priorHistory &&
      Number.isFinite(params.priorHistory.n) && params.priorHistory.n >= 1 &&
      Number.isFinite(params.priorHistory.meanOverrunFrac);
    if (hasPriorHistory) {
      smoothedParams.priorHistory = params.priorHistory;
      console.log('generateBaseline: Using MCMC Bayesian baseline (priorHistory n=' + params.priorHistory.n + ')');
    }
    const monteCarloSmoothedPoints = hasPriorHistory
      ? generateMCMCSmoothedPoints(smoothedParams)
      : generateMonteCarloSmoothedPoints(smoothedParams);
    if (monteCarloSmoothedPoints.error ||
        !isValidPdfArray(monteCarloSmoothedPoints.pdfPoints) ||
        !isValidCdfArray(monteCarloSmoothedPoints.cdfPoints)) {
      throw new Error('Invalid Monte Carlo smoothed points');
    }
    monteCarloSmoothedPoints.cdfPoints = ensureSortedMonotoneCdf(monteCarloSmoothedPoints.cdfPoints);

    // NEW: Compute 95% CI using existing invertCdf helper
    let ciLower = NaN;
    let ciUpper = NaN;
    if (monteCarloSmoothedPoints.cdfPoints?.length >= 2) {
      const cdf = monteCarloSmoothedPoints.cdfPoints;
      const loQ = (1 - 0.95) / 2;   // 0.025
      const hiQ = 1 - loQ;          // 0.975
      ciLower = invertCdf(cdf, loQ);
      ciUpper = invertCdf(cdf, hiQ);
      // Attach directly to monteCarloSmoothedPoints for envelope
      monteCarloSmoothedPoints.ci = { lower: ciLower, upper: ciUpper };
      console.log('generateBaseline: Added 95% CI → lower:', ciLower, 'upper:', ciUpper);
    }

    // Metrics (PERT, CI, CV, etc.)
    const metrics = calculateMetrics({
      optimistic,
      mostLikely,
      pessimistic,
      triangle: trianglePoints.pdfPoints.length
        ? { pdfPoints: trianglePoints.pdfPoints, cdfPoints: trianglePoints.cdfPoints }
        : undefined,
      monteCarloSmoothed: { pdfPoints: monteCarloSmoothedPoints.pdfPoints, cdfPoints: monteCarloSmoothedPoints.cdfPoints },
      confidenceLevel: 0.95,
      robustStd: 0
    });
    if (metrics?.error) raise(`calculateMetrics failed: ${metrics.error}`, metrics.details || {});

    const pertMean = Number(metrics?.pert?.mean);

    // KL divergence (diagnostic) — already computed earlier
    const klObj = computeKLDivergence({
      distributions: {
        triangle: trianglePoints,
        monteCarloSmoothed: monteCarloSmoothedPoints
      },
      task: 'baseline'
    });
    const kld = klObj && klObj['triangle-monteCarloSmoothed'];

    // NEW: Attach KL directly to monteCarloSmoothedPoints so it reaches the envelope
    if (Number.isFinite(kld)) {
      monteCarloSmoothedPoints.klDivergenceToTriangle = kld;
      console.log('generateBaseline: Attached KL divergence to triangle:', kld);
    }

    console.log('generateBaseline: Completed', {
      ciLower, ciUpper, kld,
      mcPdf: monteCarloSmoothedPoints.pdfPoints.length,
      mcCdf: monteCarloSmoothedPoints.cdfPoints.length
    });

    return {
      trianglePoints,
      pertPoints,
      betaPoints,
      monteCarloRawPoints,
      monteCarloSmoothedPoints,
      metrics: {
        monteCarloSmoothed: { ci: { lower: ciLower, upper: ciUpper } },
        klDivergenceToTriangle: kld
      },
      ci: { monteCarloSmoothed: { lower: ciLower, upper: ciUpper } },
      confidenceInterval: { lower: ciLower, upper: ciUpper },
      pert: { mean: pertMean },
      monteCarloSmoothed: {
        pdfPoints: monteCarloSmoothedPoints.pdfPoints,
        cdfPoints: monteCarloSmoothedPoints.cdfPoints,
        ci: monteCarloSmoothedPoints.ci || { lower: ciLower, upper: ciUpper },
        klDivergenceToTriangle: monteCarloSmoothedPoints.klDivergenceToTriangle || kld
      },
      alpha, beta,
      posteriorStats: monteCarloSmoothedPoints.posteriorStats || null,
      baselineMode: hasPriorHistory ? 'mcmc' : 'montecarlo',
      error: null
    };
  } catch (error) {
    console.error('generateBaseline: Error', { message: error.message, stack: error.stack });
    return { error: `Failed to generate baseline: ${error.message || 'Unknown error'}` };
  }
}
