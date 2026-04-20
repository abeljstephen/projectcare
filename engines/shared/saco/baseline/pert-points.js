// Ported from system-google-sheets-addon/core/baseline/pert-points.gs
// baseline/pert-points.gs — Beta distribution utilities + PERT points generation (pure Apps Script - global)
// Force sync - Jan 16 2026 - Node.js removed, async removed (logic is synchronous)

// Lanczos coefficients for log-gamma (double-precision accuracy)
var LANCZOS_COEFFS = [
  676.5203681218851,   -1259.1392167224028,
  771.32342877765313,  -176.61502916214059,
  12.507343278686905,  -0.13857109526572012,
  9.9843695780195716e-6, 1.5056327351493116e-7
];

// logGamma function (log of gamma function) - used for stable beta PDF computation
function logGamma(z) {
  if (z < 0.5) {
    // Reflection formula
    return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
  }
  z -= 1;
  let x = 0.99999999999980993;
  for (let i = 0; i < LANCZOS_COEFFS.length; i++) {
    x += LANCZOS_COEFFS[i] / (z + i + 1);
  }
  const t = z + LANCZOS_COEFFS.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

// Gamma sampler (Marsaglia–Tsang method for k > 1, Ahrens–Dieter for 0 < k <= 1)
function gammaSample(shape) {
  if (shape <= 0) return NaN;
  if (shape > 1) {
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    while (true) {
      let x, y, r2;
      do {
        x = 2 * Math.random() - 1;
        y = 2 * Math.random() - 1;
        r2 = x * x + y * y;
      } while (r2 === 0 || r2 >= 1);
      const n = x * Math.sqrt(-2 * Math.log(r2) / r2);

      const v = Math.pow(1 + c * n, 3);
      if (v <= 0) continue;
      const u = Math.random();
      const lhs = Math.log(u);
      const rhs = 0.5 * n * n + d - d * v + d * Math.log(v);
      if (lhs <= rhs) return d * v;
    }
  }
  // For 0 < k <= 1, boost to k+1 then thin
  const u = Math.random();
  return gammaSample(shape + 1) * Math.pow(u, 1 / shape);
}

// Beta sampler (uses gammaSample)
function betaSample(alpha, beta) {
  const ga = gammaSample(alpha);
  const gb = gammaSample(beta);
  const s = ga + gb;
  return (ga > 0 && s > 0) ? (ga / s) : NaN;
}

// Beta PDF density on unit interval [0,1] (log-space for numerical stability)
function betaPdf(u, alpha, beta) {
  if (u <= 0 || u >= 1 || alpha <= 0 || beta <= 0) return 0;
  const logNum = (alpha - 1) * Math.log(u) + (beta - 1) * Math.log(1 - u);
  const logDen = logGamma(alpha) + logGamma(beta) - logGamma(alpha + beta);
  return Math.exp(logNum - logDen);
}

// Asymmetry-adaptive PERT mapping: (O, M, P) → (α, β)
// λ is derived from the modal fraction m=(M-O)/(P-O) via λ=1/(m(1-m)),
// which recovers the canonical λ=4 when the mode is centred (m=0.5) and
// rises for asymmetric estimates, reflecting that an off-centre mode is a
// stronger signal about the distribution shape.
// Basis: Golenko-Ginzburg (1988); Herrerías-Velasco et al. (2003).
function computeBetaMoments(params) {
  console.log('computeBetaMoments: Starting', { params });
  try {
    const { optimistic: O, mostLikely: M, pessimistic: P } = params || {};
    if (![O, M, P].every(Number.isFinite)) {
      throw new Error('Invalid estimates: must be finite numbers');
    }
    if (O > M || M > P) {
      throw new Error('Estimates must satisfy optimistic <= mostLikely <= pessimistic');
    }
    const r = P - O;
    if (!(r > 0)) throw new Error('Degenerate case: zero range');

    // Asymmetry-adaptive λ: 1/(m(1-m)), clamped to [2, 8].
    // m(1-m) has its maximum (0.25) at m=0.5, giving λ=4 (the canonical value).
    // As m departs from centre, m(1-m) falls, λ rises — up to the cap of 8.
    const m      = (M - O) / r;                     // modal fraction ∈ (0, 1)
    const mVar   = m * (1 - m);                      // max 0.25 at m=0.5
    const lambda = mVar > 1e-9
      ? Math.max(2, Math.min(8, 1 / mVar))           // adaptive: λ=4 at m=0.5
      : 8;                                           // near-degenerate mode: cap at 8

    let alpha = 1 + lambda * (M - O) / r;
    let beta  = 1 + lambda * (P - M) / r;

    const EPS = 1e-6;
    if (!(alpha > 0) || !(beta > 0) || !Number.isFinite(alpha) || !Number.isFinite(beta)) {
      throw new Error('Invalid alpha/beta from PERT mapping');
    }
    if (alpha < 1) alpha = 1 + EPS;
    if (beta  < 1) beta  = 1 + EPS;

    console.log('computeBetaMoments: Completed', { alpha, beta, lambda, m });
    return { alpha, beta, lambda };
  } catch (error) {
    console.error('computeBetaMoments: Error', { message: error.message, stack: error.stack });
    return { alpha: null, beta: null, error: error.message };
  }
}

// Generate (scaled) Beta PDF/CDF over [O,P] for PERT distribution
function generatePertPoints(params) {
  console.log('generatePertPoints: Starting', { params });
  try {
    const { optimistic, mostLikely, pessimistic, numSamples = 200 } = params;

    if (![optimistic, mostLikely, pessimistic].every(Number.isFinite)) {
      throw new Error('Invalid estimates: must be finite numbers');
    }
    if (optimistic > mostLikely || mostLikely > pessimistic) {
      throw new Error('Estimates must satisfy optimistic <= mostLikely <= pessimistic');
    }
    if (pessimistic - optimistic <= 0) {
      throw new Error('Degenerate case: single point distribution');
    }
    if (!Number.isFinite(numSamples) || numSamples < 2) {
      throw new Error('Invalid numSamples: must be a number >= 2');
    }

    // Compute alpha/beta using canonical PERT (λ=4)
    const { alpha, beta, error: abErr } = computeBetaMoments({ optimistic, mostLikely, pessimistic });
    if (abErr) {
      throw new Error(`computeBetaMoments error: ${abErr}`);
    }
    if (![alpha, beta].every(v => Number.isFinite(v) && v > 0)) {
      throw new Error('Invalid alpha or beta values');
    }

    const range = pessimistic - optimistic;
    const step = range / (numSamples - 1);

    // PDF on regular grid over [O, P]
    const pdf = [];
    for (let i = 0; i < numSamples; i++) {
      const x = optimistic + i * step;
      // Use ε at endpoints so betaPdf boundary guard (u≤0 or u≥1 → 0) doesn't suppress
      // a true non-zero density when α=1 (M=O) or β=1 (M=P)
      const u = i === 0 ? 1e-10 : (i === numSamples - 1 ? 1 - 1e-10 : (x - optimistic) / range);
      const y = betaPdf(u, alpha, beta) / range;
      if (!Number.isFinite(y)) {
        console.warn('Invalid PDF value at x=' + x + ', u=' + u + ', y=' + y);
        continue; // skip bad point
      }
      pdf.push({ x, y });
    }

    console.log('generatePertPoints: Generated ' + pdf.length + ' PDF points');

    // Normalize PDF (trapezoidal area = 1)
    let area = 0;
    for (let i = 1; i < pdf.length; i++) {
      const dx = pdf[i].x - pdf[i - 1].x;
      if (!Number.isFinite(dx) || dx <= 0) {
        console.warn('Invalid dx in normalization at i=' + i + ': dx=' + dx);
        continue;
      }
      area += 0.5 * (pdf[i].y + pdf[i - 1].y) * dx;
    }
    if (!(area > 0 && Number.isFinite(area))) {
      console.warn('Invalid PDF area: ' + area + ' - using fallback normalization');
      area = 1; // prevent division by zero
    }
    const nPdf = pdf.map(p => ({ x: p.x, y: p.y / area }));

    // CDF (same-length, cumulative trapezoid), enforce hygiene
    const cdf = [];
    let cum = 0;
    cdf.push({ x: nPdf[0].x, y: 0 });
    for (let i = 1; i < nPdf.length; i++) {
      const dx = nPdf[i].x - nPdf[i - 1].x;
      if (!Number.isFinite(dx) || dx <= 0) {
        console.warn('Invalid dx in CDF computation at i=' + i + ': dx=' + dx);
        continue;
      }
      cum += 0.5 * (nPdf[i - 1].y + nPdf[i].y) * dx;
      cdf.push({ x: nPdf[i].x, y: Math.max(0, Math.min(1, cum)) });
    }

    // Final hygiene: ensure monotone and tail=1.0
    for (let i = 1; i < cdf.length; i++) {
      if (cdf[i].y < cdf[i - 1].y) {
        cdf[i].y = cdf[i - 1].y; // enforce non-decreasing
      }
    }
    if (cdf.length) cdf[cdf.length - 1].y = 1.0;

    console.log('generatePertPoints: Completed', {
      pdfPointsLength: nPdf.length,
      cdfPointsLength: cdf.length
    });

    return { pdfPoints: nPdf, cdfPoints: cdf };
  } catch (error) {
    console.error('generatePertPoints: Error', { message: error.message, stack: error.stack });
    return { pdfPoints: [], cdfPoints: [], error: error.message };
  }
}
