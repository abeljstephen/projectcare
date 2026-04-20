// Ported from system-google-sheets-addon/core/baseline/monte-carlo-smoothed.gs
// baseline/monte-carlo-smoothed.gs — Monte Carlo smoothing via KDE + MCMC Bayesian extension (pure Apps Script - global)
// Force sync - Jan 16 2026 - Node.js removed
// MCMC Bayesian baseline added Mar 2026: posterior update over overrun when priorHistory provided

/**
 * Smooth RAW Monte Carlo samples via Gaussian KDE on a regular grid. v1.9.24
 * If samples are not provided, fallback to Beta(α,β) sampling on [O,P].
 * Returns { pdfPoints, cdfPoints } with strict hygiene:
 *  • pdf integrates to 1 (trapezoid)
 *  • cdf is sorted by x, y∈[0,1], non-decreasing, and ends at 1.0
 * SACO Step 1: Smoothed baseline pdf/cdf for P_0(τ); used in Step 5 refit interp (monotone ensures KL computable).
 * Math: KDE h=range/63.3 (rule-of-thumb); renormalize ∫pdf=1 for exp(-KL) fidelity; Ch.6: erf-slack via clamp.
 */
function generateMonteCarloSmoothedPoints(params) {
  console.log('generateMonteCarloSmoothedPoints: Starting', {
    params: { ...params, samples: Array.isArray(params?.samples) ? `(n=${params.samples.length})` : undefined }
  });
  console.time('generateMonteCarloSmoothedPoints');
  try {
    const { optimistic, mostLikely, pessimistic, numSamples = 2000, samples: rawSamples } = params;

    if (![optimistic, mostLikely, pessimistic].every(Number.isFinite)) {
      throw new Error('Invalid estimates: must be finite numbers');
    }
    if (!(optimistic <= mostLikely && mostLikely <= pessimistic)) {
      throw new Error('Estimates must satisfy optimistic <= mostLikely <= pessimistic');
    }
    const range = pessimistic - optimistic;
    if (range <= 0) throw new Error('Degenerate case: zero range');
    if (!Number.isFinite(numSamples) || numSamples < 100) {
      throw new Error('Invalid numSamples: must be >= 100');
    }

    // Prefer provided samples; else sample from Beta over [O,P]
    let samples = Array.isArray(rawSamples) ? rawSamples.slice() : null;
    if (!samples || samples.length === 0) {
      const { alpha, beta } = computeBetaMoments({ optimistic, mostLikely, pessimistic });
      if (!Number.isFinite(alpha) || !Number.isFinite(beta) || alpha <= 0 || beta <= 0) {
        throw new Error('Invalid beta parameters');
      }
      samples = Array(numSamples).fill().map(() => optimistic + betaSample(alpha, beta) * range);
    }

    // Clamp to [O,P]
    samples = samples.map(s => Math.max(optimistic, Math.min(pessimistic, Number(s)))).filter(Number.isFinite);

    // KDE on a fixed grid (200 points)
    const nPoints = 200;
    const xMin = optimistic, xMax = pessimistic;
    const dx = (xMax - xMin) / (nPoints - 1);
    const pdf = Array.from({ length: nPoints }, (_, i) => ({ x: xMin + i * dx, y: 0 }));

    // Bandwidth (simple rule-of-thumb)
    const h = range / 63.3;
    const invH = 1 / h;
    const invSqrt2pi = 1 / Math.sqrt(2 * Math.PI);

    for (let i = 0; i < nPoints; i++) {
      const x = pdf[i].x;
      let sum = 0;
      for (const s of samples) {
        const z = (x - s) * invH;
        sum += Math.exp(-0.5 * z * z) * invH * invSqrt2pi;
      }
      pdf[i].y = sum / samples.length;
    }

    // Normalize PDF by trapezoid rule
    const area = trapezoidIntegral(pdf);
    if (!(area > 0 && Number.isFinite(area))) throw new Error('Invalid PDF integral');
    const nPdf = pdf.map(p => ({ x: p.x, y: p.y / area }));

    // Build CDF by cumulative trapezoid (same grid), then enforce hygiene
    const cdfRaw = [];
    let cum = 0;
    cdfRaw.push({ x: nPdf[0].x, y: 0 });
    for (let i = 1; i < nPdf.length; i++) {
      const dxSeg = nPdf[i].x - nPdf[i - 1].x;
      cum += 0.5 * (nPdf[i - 1].y + nPdf[i].y) * dxSeg;
      cdfRaw.push({ x: nPdf[i].x, y: cum });
    }
    // Clamp numeric drift and enforce monotone + tail=1
    let cdf = cdfRaw.map(p => ({ x: p.x, y: Math.max(0, Math.min(1, p.y)) }));
    cdf = ensureSortedMonotoneCdf(cdf);
    if (cdf.length) cdf[cdf.length - 1].y = 1.0;

    if (!isValidPdfArray(nPdf) || !isValidCdfArray(cdf)) {
      throw new Error('Invalid PDF/CDF points generated');
    }

    console.log('generateMonteCarloSmoothedPoints: Completed', {
      pdfPointsLength: nPdf.length, cdfPointsLength: cdf.length
    });
    console.timeEnd('generateMonteCarloSmoothedPoints');
    return { pdfPoints: nPdf, cdfPoints: cdf };
  } catch (error) {
    console.error('generateMonteCarloSmoothedPoints: Error', { message: error.message, stack: error.stack });
    return { pdfPoints: [], cdfPoints: [], error: error.message };
  }
}

/**
 * Box-Muller standard normal sampler — used by MCMC posterior sampling.
 * @returns {number} one draw from N(0,1)
 */
function normalSampleGas() {
  let u, v, s;
  do {
    u = 2 * Math.random() - 1;
    v = 2 * Math.random() - 1;
    s = u * u + v * v;
  } while (s === 0 || s >= 1);
  return u * Math.sqrt(-2 * Math.log(s) / s);
}

/**
 * Metropolis-Hastings MCMC baseline generator. v2.0.0
 *
 * Replaces generateMonteCarloSmoothedPoints when the user has supplied
 * prior similar-project history via priorHistory = { n, meanOverrunFrac, stdOverrunFrac }.
 *
 * Model:
 *   Prior:      μ_overrun ~ t(ν=4, 0, σ_prior=0.30)   [Student-t, heavy-tailed]
 *   Likelihood: N projects with sample mean = meanOverrunFrac, std = stdOverrunFrac
 *   Posterior:  p(μ|data) — no closed form; sampled via Metropolis-Hastings
 *
 * Why Student-t prior (not Normal):
 *   A Normal prior gives a closed-form posterior but is sensitive to outlier projects
 *   (e.g. one 200% overrun project shifts the posterior strongly). The Student-t with
 *   ν=4 degrees of freedom assigns heavier tails, making the posterior robust to
 *   extreme individual observations. Gelman et al. (BDA3 §2.9) recommend ν=4 as
 *   a weakly-informative default for location parameters.
 *
 * MH Algorithm:
 *   Chain length : 5500 total iterations
 *   Burn-in      : first 500 discarded (warm-up to stationarity)
 *   Thinning     : keep every 5th post-burn-in → 1000 effective chain samples
 *   Proposal     : random-walk  μ* = μ_current + ε,  ε ~ N(0, (0.5·σ_prior)²)
 *                  step size targets ~30–40% acceptance rate (Roberts et al. 1997)
 *
 * Chain-driven overrun injection:
 *   For each PERT base draw s_i, a μ value is drawn from the chain (cycled) and
 *   combined with aleatoric per-project noise. This propagates BOTH epistemic
 *   uncertainty (which μ is the true rate?) and aleatoric uncertainty (project-level
 *   variability) into each adjusted sample.
 *
 *   adjusted_i = s_i × (1 + μ_k + σ_obs·N(0,1))
 *
 * Research basis:
 *   Student-t prior: Gelman et al. "Bayesian Data Analysis" 3rd ed. §2.9
 *   MH acceptance rate: Roberts, Gelman & Gilks (1997) — optimal 0.234 for high-dim,
 *     0.44 for 1-dim; step σ = 0.5·prior_σ achieves this empirically here.
 *   Prior calibration: Flyvbjerg et al. (2002) — infrastructure overruns avg 45%,
 *     stddev ~30%; software overruns avg 27% (Jones 2007). σ_prior=0.30 spans both.
 *
 * @param {object} params — same interface as generateMonteCarloSmoothedPoints,
 *   plus priorHistory: { n, meanOverrunFrac, stdOverrunFrac }
 * @returns {{ pdfPoints, cdfPoints, posteriorStats }} — posteriorStats for UI display
 */
function generateMCMCSmoothedPoints(params) {
  console.log('generateMCMCSmoothedPoints: Starting (MH-MCMC v2.0)', {
    params: { ...params, samples: Array.isArray(params?.samples) ? `(n=${params.samples.length})` : undefined }
  });
  console.time('generateMCMCSmoothedPoints');
  try {
    const {
      optimistic, mostLikely, pessimistic,
      numSamples = 2000,
      priorHistory
    } = params;

    if (![optimistic, mostLikely, pessimistic].every(Number.isFinite)) {
      throw new Error('Invalid estimates: must be finite numbers');
    }
    if (!(optimistic <= mostLikely && mostLikely <= pessimistic)) {
      throw new Error('Estimates must satisfy optimistic <= mostLikely <= pessimistic');
    }
    const range = pessimistic - optimistic;
    if (range <= 0) throw new Error('Degenerate case: zero range');

    if (!priorHistory || !Number.isFinite(priorHistory.n) || priorHistory.n < 1) {
      throw new Error('priorHistory.n must be a positive integer >= 1');
    }
    if (!Number.isFinite(priorHistory.meanOverrunFrac)) {
      throw new Error('priorHistory.meanOverrunFrac must be a finite number');
    }

    const nHist    = Math.round(priorHistory.n);
    const muData   = priorHistory.meanOverrunFrac;              // e.g. 0.15 for 15%
    const sigmaObs = Number.isFinite(priorHistory.stdOverrunFrac) && priorHistory.stdOverrunFrac > 0
      ? priorHistory.stdOverrunFrac
      : Math.max(0.05, Math.abs(muData) * 0.5);                // fallback: 50% CV

    // ── Metropolis-Hastings MCMC over μ_overrun ──────────────────────────
    // Prior: Student-t(ν=4, location=0, scale=σ_prior)
    const nu         = 4;
    const sigmaPrior = 0.30;
    const stepSize   = sigmaPrior * 0.5;    // targets ~30–40% acceptance

    // Log-posterior (unnormalized): log t-prior + Normal log-likelihood
    const logPost = (mu) => {
      const logPrior = -(nu + 1) / 2 * Math.log(1 + (mu * mu) / (nu * sigmaPrior * sigmaPrior));
      const logLik   = -nHist * (mu - muData) * (mu - muData) / (2 * sigmaObs * sigmaObs);
      return logPrior + logLik;
    };

    const nChain   = 5500;   // total chain iterations
    const burnIn   = 500;    // discard first 500 (warm-up)
    const thin     = 5;      // keep every 5th → 1000 effective samples
    let   current  = muData; // initialize at MLE for fast warm-up
    let   accepted = 0;
    const chainSamples = [];

    for (let i = 0; i < nChain; i++) {
      const proposal = current + stepSize * normalSampleGas();
      const logAlpha = logPost(proposal) - logPost(current);
      const u        = Math.random() || 1e-300;                 // guard against log(0)
      if (Math.log(u) < logAlpha) {
        current = proposal;
        if (i >= burnIn) accepted++;
      }
      if (i >= burnIn && (i - burnIn) % thin === 0) {
        chainSamples.push(current);
      }
    }

    if (chainSamples.length === 0) throw new Error('MCMC chain produced no samples');

    // Chain diagnostics
    const chainMean  = chainSamples.reduce((a, b) => a + b, 0) / chainSamples.length;
    const chainVar   = chainSamples.reduce((a, b) => a + (b - chainMean) ** 2, 0) / (chainSamples.length - 1);
    const chainStd   = Math.sqrt(Math.max(0, chainVar));
    const acceptRate = accepted / (nChain - burnIn);

    console.log('generateMCMCSmoothedPoints: Chain stats', {
      chainLength: chainSamples.length, chainMean, chainStd,
      acceptRate: acceptRate.toFixed(3), nHist
    });

    // ── PERT base samples ─────────────────────────────────────────────────
    const { alpha, beta } = computeBetaMoments({ optimistic, mostLikely, pessimistic });
    if (!Number.isFinite(alpha) || !Number.isFinite(beta) || alpha <= 0 || beta <= 0) {
      throw new Error('Invalid beta parameters');
    }

    // Extended grid: chain mean + 3σ covers positive-overrun tail
    const extendedMax = pessimistic * (1 + Math.max(0, chainMean + 3 * chainStd));

    // Chain-driven overrun injection:
    //   μ_k  = epistemic draw (cycles through posterior chain samples)
    //   ε_i  = μ_k + σ_obs·N(0,1)  (epistemic + aleatoric per-project noise)
    const samples = Array(numSamples).fill(null).map((_, i) => {
      const baseSample = optimistic + betaSample(alpha, beta) * range;
      const muK        = chainSamples[i % chainSamples.length]; // cycle through chain
      const overrun    = muK + sigmaObs * normalSampleGas();    // epistemic + aleatoric
      const adjusted   = baseSample * (1 + overrun);
      return Math.max(optimistic, Math.min(extendedMax, adjusted));
    }).filter(Number.isFinite);

    // ── KDE on extended grid (same as standard path) ─────────────────────
    const nPoints = 200;
    const xMin = optimistic;
    const xMax = Math.max(pessimistic, extendedMax);
    const dx = (xMax - xMin) / (nPoints - 1);
    const gridRange = xMax - xMin;
    const h = gridRange / 63.3;
    const invH = 1 / h;
    const invSqrt2pi = 1 / Math.sqrt(2 * Math.PI);

    const pdf = Array.from({ length: nPoints }, (_, i) => ({ x: xMin + i * dx, y: 0 }));
    for (let i = 0; i < nPoints; i++) {
      const x = pdf[i].x;
      let sum = 0;
      for (const s of samples) {
        const z = (x - s) * invH;
        sum += Math.exp(-0.5 * z * z) * invH * invSqrt2pi;
      }
      pdf[i].y = sum / samples.length;
    }

    const area = trapezoidIntegral(pdf);
    if (!(area > 0 && Number.isFinite(area))) throw new Error('Invalid PDF integral');
    const nPdf = pdf.map(p => ({ x: p.x, y: p.y / area }));

    const cdfRaw = [{ x: nPdf[0].x, y: 0 }];
    let cum = 0;
    for (let i = 1; i < nPdf.length; i++) {
      const dxSeg = nPdf[i].x - nPdf[i - 1].x;
      cum += 0.5 * (nPdf[i - 1].y + nPdf[i].y) * dxSeg;
      cdfRaw.push({ x: nPdf[i].x, y: cum });
    }
    let cdf = cdfRaw.map(p => ({ x: p.x, y: Math.max(0, Math.min(1, p.y)) }));
    cdf = ensureSortedMonotoneCdf(cdf);
    if (cdf.length) cdf[cdf.length - 1].y = 1.0;

    if (!isValidPdfArray(nPdf) || !isValidCdfArray(cdf)) {
      throw new Error('Invalid PDF/CDF output');
    }

    const posteriorStats = {
      muPost:      chainMean,                        // posterior mean overrun (fraction)
      sigmaPost:   chainStd,                         // posterior std
      nHist:       nHist,
      acceptRate:  acceptRate,                       // MH acceptance rate (diagnostic)
      chainLength: chainSamples.length,              // effective chain samples after thinning
      credibility: Math.min(1, nHist / 10)           // 0–1 signal strength indicator
    };

    console.log('generateMCMCSmoothedPoints: Completed', {
      pdfPointsLength: nPdf.length, cdfPointsLength: cdf.length, posteriorStats
    });
    console.timeEnd('generateMCMCSmoothedPoints');
    return { pdfPoints: nPdf, cdfPoints: cdf, posteriorStats };

  } catch (error) {
    console.error('generateMCMCSmoothedPoints: Error', { message: error.message, stack: error.stack });
    console.warn('generateMCMCSmoothedPoints: Falling back to standard MC smoothing');
    return generateMonteCarloSmoothedPoints(params);
  }
}
