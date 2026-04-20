// AUTO-GENERATED — do not edit directly.
// Source: engines/shared/saco/baseline/monte-carlo-raw.js
// Run: bash scripts/sync-gas.sh before clasp push.
// Ported from system-google-sheets-addon/core/baseline/monte-carlo-raw.gs
// baseline/monte-carlo-raw.gs — Raw Monte Carlo sampling (pure Apps Script - global)
// Force sync - Jan 16 2026 - Node.js removed

/**
 * Generate RAW Monte Carlo points by sampling Beta(α,β) mapped to [O,P]. v1.9.24
 * Returns histogram-based PDF/CDF *and* the underlying samples array.
 * SACO Step 1: Raw samples → cv=(P-O)/μ_0, skew for bias=0.15 if v>0.5/p0<0.3 (grid tilt).
 * Math: Beta samples preserve shape (α_0/β_0 from PERT); used in Step 6 bootstrap (5x resamples for std err).
 */
function generateMonteCarloRawPoints(params) {
  console.log('generateMonteCarloRawPoints: Starting', { params });
  try {
    const { optimistic, mostLikely, pessimistic, numSamples = 1000 } = params;

    if (![optimistic, mostLikely, pessimistic].every(Number.isFinite)) {
      throw new Error('Invalid estimates: must be finite numbers');
    }
    if (optimistic > mostLikely || mostLikely > pessimistic) {
      throw new Error('Estimates must satisfy optimistic <= mostLikely <= pessimistic');
    }
    const range = pessimistic - optimistic;
    if (range <= 0) throw new Error('Degenerate case: single point distribution');
    if (!Number.isFinite(numSamples) || numSamples < 2) throw new Error('Invalid numSamples: must be a number >= 2');

    // Always compute alpha/beta from O/M/P here (progression requirement)
    const { alpha, beta } = computeBetaMoments({ optimistic, mostLikely, pessimistic });
    if (!Number.isFinite(alpha) || !Number.isFinite(beta) || alpha <= 0 || beta <= 0) {
      throw new Error('Invalid alpha or beta values');
    }

    // Draw samples from Beta(α,β) on [0,1] and map to [O,P]
    const samples = [];
    for (let i = 0; i < numSamples; i++) {
      const u = betaSample(alpha, beta); // Pure JS sample (from beta-points.js)
      const s = optimistic + u * range;
      if (!Number.isFinite(u) || !Number.isFinite(s)) throw new Error('Invalid Monte Carlo sample');
      samples.push(s);
    }

    // PATCH: Adaptive bins: Coarsen if sparse (range < 500 → fewer bins)
    const effectiveSamples = Math.max(50, Math.min(numSamples, Math.ceil(range / 10)));
    const step = range / (effectiveSamples - 1);
    const hist = new Array(effectiveSamples).fill(0);

    // Bin samples for PDF (histogram density)
    for (const s of samples) {
      const idx = Math.min(effectiveSamples - 1, Math.max(0, Math.floor((s - optimistic) / step)));
      hist[idx]++;
    }

    // PDF points: Mid-bin x, normalized density y = count / (n * width)
    const pdfPoints = hist.map((count, i) => {
      const x = optimistic + (i + 0.5) * step;
      const y = count / (numSamples * step);
      return { x, y };
    });

    // CDF points: Empirical from sorted samples — Hazen plotting position y=(i+0.5)/n
    // avoids F(x_min)=0 bias; gives unbiased empirical CDF for uniform order statistics.
    const sortedSamples = samples.slice().sort((a, b) => a - b);
    const cdfPoints = sortedSamples.map((s, i) => ({ x: s, y: (i + 0.5) / numSamples }));

    console.log('generateMonteCarloRawPoints: Completed', {
      pdfPointsLength: pdfPoints.length,
      cdfPointsLength: cdfPoints.length,
      samplesLength: samples.length
    });

    return { pdfPoints, cdfPoints, samples: sortedSamples };
  } catch (error) {
    console.error('generateMonteCarloRawPoints: Error', { message: error.message, stack: error.stack });
    return { pdfPoints: [], cdfPoints: [], samples: [], error: error.message };
  }
}
