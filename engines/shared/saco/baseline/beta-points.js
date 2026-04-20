// Ported from system-google-sheets-addon/core/baseline/beta-points.gs
// baseline/beta-points.gs — Beta distribution utilities (pure Apps Script - global)
// Force sync - Jan 16 2026 - Node.js removed

// Lanczos coefficients for log-gamma (double-precision accuracy)
var _bp_LANCZOS_COEFFS = [
  676.5203681218851,   -1259.1392167224028,
  771.32342877765313,  -176.61502916214059,
  12.507343278686905,  -0.13857109526572012,
  9.9843695780195716e-6, 1.5056327351493116e-7
];

// _bp_logGamma function (log of gamma function)
function _bp_logGamma(z) {
  if (z < 0.5) {
    return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - _bp_logGamma(1 - z);
  }
  z -= 1;
  let x = 0.99999999999980993;
  for (let i = 0; i < _bp_LANCZOS_COEFFS.length; i++) {
    x += _bp_LANCZOS_COEFFS[i] / (z + i + 1);
  }
  const t = z + _bp_LANCZOS_COEFFS.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

// Gamma sampler (Marsaglia–Tsang method)
function _bp_gammaSample(shape) {
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
  const u = Math.random();
  return _bp_gammaSample(shape + 1) * Math.pow(u, 1 / shape);
}

// Beta sampler
function _bp_betaSample(alpha, beta) {
  const ga = _bp_gammaSample(alpha);
  const gb = _bp_gammaSample(beta);
  const s = ga + gb;
  return (ga > 0 && s > 0) ? (ga / s) : NaN;
}

// Beta PDF (unit interval [0,1])
function _bp_betaPdf(u, alpha, beta) {
  if (u <= 0 || u >= 1 || alpha <= 0 || beta <= 0) return 0;
  const logNum = (alpha - 1) * Math.log(u) + (beta - 1) * Math.log(1 - u);
  const logDen = _bp_logGamma(alpha) + _bp_logGamma(beta) - _bp_logGamma(alpha + beta);
  return Math.exp(logNum - logDen);
}

// Canonical PERT (λ=4) mapping: (O, M, P) → (α, β)
function _bp_computeBetaMoments(params) {
  console.log('_bp_computeBetaMoments: Starting', { params });
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

    const lambda = 4;
    let alpha = 1 + lambda * (M - O) / r;
    let beta  = 1 + lambda * (P - M) / r;

    const EPS = 1e-6;
    if (!(alpha > 0) || !(beta > 0) || !Number.isFinite(alpha) || !Number.isFinite(beta)) {
      throw new Error('Invalid alpha/beta from PERT mapping');
    }
    if (alpha < 1) alpha = 1 + EPS;
    if (beta  < 1) beta  = 1 + EPS;

    console.log('_bp_computeBetaMoments: Completed', { alpha, beta, lambda });
    return { alpha, beta };
  } catch (error) {
    console.error('_bp_computeBetaMoments: Error', { message: error.message, stack: error.stack });
    return { alpha: null, beta: null, error: error.message };
  }
}

// Generate (scaled) Beta PDF/CDF over [O,P]
function generateBetaPoints(params) {
  console.log('generateBetaPoints: Starting', { params });
  try {
    const { optimistic: O, mostLikely: M, pessimistic: P, numSamples = 200, alpha, beta } = params || {};

    if (![O, M, P].every(Number.isFinite)) {
      throw new Error('Invalid estimates: must be finite numbers');
    }
    if (O > M || M > P) throw new Error('Estimates must satisfy optimistic <= mostLikely <= pessimistic');
    const r = P - O;
    if (!(r > 0)) throw new Error('Degenerate case: zero range');
    if (!Number.isFinite(numSamples) || numSamples < 2) {
      throw new Error('Invalid numSamples: must be >= 2');
    }
    if (!Number.isFinite(alpha) || !Number.isFinite(beta) || alpha <= 0 || beta <= 0) {
      throw new Error('Invalid alpha or beta values');
    }

    const step = r / (numSamples - 1);
    const pdfPoints = [];
    for (let i = 0; i < numSamples; i++) {
      const x = O + i * step;
      const u = (x - O) / r;
      const y = _bp_betaPdf(u, alpha, beta) / r;
      if (!Number.isFinite(y) || y < 0) {
        throw new Error(`Invalid PDF value at x=${x}, u=${u}, y=${y}`);
      }
      pdfPoints.push({ x, y });
    }

    let area = 0;
    for (let i = 1; i < pdfPoints.length; i++) {
      const dx = pdfPoints[i].x - pdfPoints[i - 1].x;
      area += 0.5 * (pdfPoints[i].y + pdfPoints[i - 1].y) * dx;
    }
    if (!(area > 0)) throw new Error('Invalid PDF area');
    const normalizedPdfPoints = pdfPoints.map(p => ({ x: p.x, y: p.y / area }));

    const cdfPoints = [];
    let cum = 0;
    cdfPoints.push({ x: normalizedPdfPoints[0].x, y: 0 });
    for (let i = 1; i < normalizedPdfPoints.length; i++) {
      const dx = normalizedPdfPoints[i].x - normalizedPdfPoints[i - 1].x;
      cum += 0.5 * (normalizedPdfPoints[i - 1].y + normalizedPdfPoints[i].y) * dx;
      cdfPoints.push({ x: normalizedPdfPoints[i].x, y: Math.max(0, Math.min(1, cum)) });
    }

    console.log('generateBetaPoints: Completed', {
      pdfPointsLength: normalizedPdfPoints.length,
      cdfPointsLength: cdfPoints.length
    });
    return { pdfPoints: normalizedPdfPoints, cdfPoints };
  } catch (error) {
    console.error('generateBetaPoints: Error', { message: error.message, stack: error.stack });
    return { pdfPoints: [], cdfPoints: [], error: error.message };
  }
}
