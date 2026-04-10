// File: reshaping/copula-utils.gs
// Deterministic, monotone copula + moments for slider aggregation.
// Cleaned for pure Apps Script - global scope, no Node.js

function clamp01(x) { return Math.max(0, Math.min(1, x)); }
function to01(x) { const v = Number(x); if (!Number.isFinite(v)) return 0; return clamp01(v / 100); }
function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] || 0) * (b[i] || 0); return s; }
function l2(a) { return Math.sqrt(dot(a, a)); }
function mix(a, b, t) { return a.map((ai, i) => (1 - t) * ai + t * (b[i] || 0)); }
function mean(a) { if (!a.length) return 0; return a.reduce((s, v) => s + v, 0) / a.length; }
function stdev(a) { const m = mean(a); const v = mean(a.map(x => (x - m) * (x - m))); return Math.sqrt(Math.max(0, v)); }

var SLIDER_KEYS = [
  'budgetFlexibility',
  'scheduleFlexibility',
  'scopeCertainty',
  'scopeReductionAllowance',
  'reworkPercentage',
  'riskTolerance',
  'userConfidence'
];

// Base correlations (positive semidefinite via small jitter) [PMBOK Ch.6: BASE_R corr for quant copula]
var BASE_R = [
  /*                 BUD   SCH   SC    SRA   RWK   RISK  CONF  */
  /* BUD */      [ 1.00, 0.40, 0.10, 0.05, 0.00,-0.05, 0.05 ],
  /* SCH */      [ 0.40, 1.00, 0.10, 0.05, 0.00,-0.05, 0.05 ],
  /* SC  */      [ 0.10, 0.10, 1.00, 0.35,-0.10, 0.00, 0.00 ],
  /* SRA */      [ 0.05, 0.05, 0.35, 1.00,-0.05, 0.00, 0.00 ],
  /* RWK */      [ 0.00, 0.00,-0.10,-0.05, 1.00,-0.10,-0.10 ],
  /* RISK*/      [-0.05,-0.05, 0.00, 0.00,-0.10, 1.00, 0.25 ],
  /* CONF*/      [ 0.05, 0.05, 0.00, 0.00,-0.10, 0.25, 1.00 ]
];

// Lightweight PSD “jitter” to ensure numerical stability [Step 5: COBYLA ρ-shrink stable]
function psdJitter(R, eps = 1e-3) {
  const out = R.map(row => row.slice());
  for (let i = 0; i < out.length; i++) {
    out[i][i] = Math.min(1.0, out[i][i] + eps);  // cap at 1.0 to preserve valid correlation matrix (diagonal must = 1)
  }
  return out;
}

// Correlation-weighted coupling signal (Patent Claim 2).
// Not a probit→Cholesky→Φ copula. Intentional design: z-scores → R·z → tanh sigmoid → U ∈ (0,1)^7.
// mean(U) = coupling scalar; t = clamp(0.3 + 0.4 × coupling) drives the linear/OR blend weight.
function computeCouplingSignal(S01) {
  const n = SLIDER_KEYS.length;
  const R = psdJitter(BASE_R, 1e-6);

  // Center & scale S to z-scores proxy (avoid zero variance collapse)
  const m = mean(S01);
  const sd = Math.max(1e-6, stdev(S01));
  const z = S01.map(s => (s - m) / sd);

  // Correlate via R (matrix-vector multiply)
  const zc = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let j = 0; j < n; j++) acc += R[i][j] * z[j];
    zc[i] = acc;
  }

  // Squash back to (0,1) via smooth sigmoid-ish map
  const U = zc.map(v => clamp01(0.5 + 0.2 * Math.tanh(v)));
  return U;
}

// Weight matrices (thesis: empiric from PMBOK buffers; signed for shift) [Math: W_MEAN for m0 lin + prob-OR]
var W_MEAN = [-0.2, 0.1, 0.3, -0.15, -0.08, 0.25, 0.05];  // m0: flex down -, cert up +
var W_VAR = [0.1, 0.1, 0.2, 0.15, 0.08, 0.5, 0.05];       // m1: risk high var

// Diag scales [0.1-0.25 bench] [Step 2: %M benchmarks, cap=0.3μ]
var DIAG_W = [0.2, 0.2, 0.15, 0.15, 0.1, 0.25, 0.1];

/**
 * Compute moments from sliders: [Step 2-3 chaining: S01 → m0/m1 → score=P'*exp(-KL)]
 *   m0 (mean weight): monotone in sliders, mixes linear w/ prob-OR for diminishing returns.
 *   m1 (variance proxy): inversely related to overall certainty (more sliders → lower var).
 *   m2, m3: small placeholders for skew/kurt (0,0) for now; reserved for future use.
 * SACO: Add scaleFactor param (mostLikely/100) to W; m1 *= (1 + cv/2) if cv provided (risky amp). [Adaptive: probe=1-7 depth scale]
 * UPDATE: SACO v1.1: Add per-slider momentsBreakdown {key: [m0_part, m1_part]} in explain for per-slider visibility [1]. [Chaining point: Breakdown seeds partialImpact explain]
 * SACO FIX v1.1 (Oct 12, 2025): Remove S01 /= scaleFactor (caused tiny m0/m1 → no lift). Now absolute frac; amp via W below. [PMBOK Ch.11: no drift reset]
 * - PATCH v1.2 (Oct 14, 2025): Set scaleFactor=1 fixed (no W amp); grid hi capped 100% raw. Fixes saturation (lin<1 at <100% sliders) → nuanced optima (40-70% vs. 0/50 bounds). [Math: m0=0.5*lin + 0.5*por; dampen=1 seeded preserves m0 for chaining fidelity]
 * @param {Object} sliders100 - Raw sliders {key: num 0-100}.
 * @param {number} [scaleFactor=1] - % scale (mostLikely/100); fixed=1 for no inflation. [Step 7: anchor lerp=0.8 drift<5%]
 * @param {number} [cv=0] - CV proxy for m1 amp. [Step 1: CV=(P-O)/μ_0; bias=0.15 if v>0.5/p0<0.3]
 */
function computeAdjustedMoments(sliders100, scaleFactor = 1, cv = 0) {
  try {
    // Normalize inputs (and handle rework: 0..100 = worse → invert to “goodness”)
    // FIX: Extract via keys (handles object primary; array fallback by index order of SLIDER_KEYS)
    const n = SLIDER_KEYS.length;
    const vals = SLIDER_KEYS.map((key, i) => {
      if (sliders100[key] !== undefined) return sliders100[key];
      return Array.isArray(sliders100) ? (sliders100[i] || 0) : 0;
    });
    const raw01 = vals.map(to01);
    // FIX: Check degenerate on raw (before invert) for coherent m0=0
    const sumRaw = raw01.reduce((s,v)=>s+v,0);
    const allZeroRaw = sumRaw < 1e-9;
    const S01 = raw01.slice();
    // Invert rework (domain 0..50 in UI usually; but we get 0..100 here -> still invert proportionally)
    const idx = {
      BUD:0, SCH:1, SC:2, SRA:3, RWK:4, RISK:5, CONF:6
    };
    S01[idx.RWK] = Math.max(0, Math.min(1, 1 - S01[idx.RWK]));

    // SACO FIX v1.1: Remove S01 /= scaleFactor (bug: tiny for large/small M). Now absolute frac; amp via W below.
    // S01.forEach((s, i) => S01[i] = s / scaleFactor); // REMOVED: Caused m0~1e-5 → no refit lift

    const sum = S01.reduce((s,v)=>s+v,0);
    const flat = stdev(S01) < 1e-6;

    // Weighted linear mean (capacity & certainty emphasized; SACO v1.2: No * scaleFactor—fixed=1 for no saturation)
    const W = [0.20,0.20,0.18,0.15,0.10,0.09,0.08]; // sums to 1.0; scaleFactor=1 implicit (absolute % effect)
    const lin = Math.max(0, Math.min(1, dot(W, S01)));

    // Prob-OR for diminishing returns
    let por = 0;
    for (let i=0;i<n;i++) por = 1 - (1 - por) * (1 - 0.9*S01[i]); // 0.9 to avoid too aggressive saturation
    por = Math.max(0, Math.min(1, por));

    // Blend linear & prob-OR depending on correlation “pressure”
    const U = computeCouplingSignal(S01);
    const coupling = mean(U); // higher means more joint “pressure”
    const t = Math.max(0, Math.min(1, 0.3 + 0.4 * coupling)); // 0.3..0.7 blend
    const m0 = allZeroRaw ? 0 : Math.max(0, Math.min(1, (1 - t)*lin + t*por));

    // m1: variance proxy — lower as sliders grow (more certainty)
    let m1Base = Math.max(0, Math.min(1, 0.8 - 0.5 * lin)); // 0.8 @ low lin → 0.3 @ high lin
    // SACO: Amp m1 for high CV (risky → more var focus)
    let m1 = m1Base * (1 + cv / 2);
    // SACO FIX v1.1: Clamp m1 >=0 to prevent negative propagation (rare but possible if lin>1.6)
    m1 = Math.max(0, m1);

    // m2,m3 placeholders (0)
    const m2 = 0;
    const m3 = 0;

    // UPDATE: SACO v1.1: Per-slider breakdown (approx w_i * S01_i scaled to total m)
    const momentsBreakdown = {};
    SLIDER_KEYS.forEach((key, i) => {
      const w = W[i];
      const s = S01[i];
      momentsBreakdown[key] = [
        m0 > 0 ? (w * s) / (m0 || 1) : 0, // m0_part
        m1 > 0 ? (w * s * (1 + cv / 2)) / (m1 || 1) : 0 // m1_part
      ];
    });

    // SACO THESIS INTEGRATION: Linear moments via W_MEAN/W_VAR (empiric weights; PSD corr via diag)
    let m0_thesis = 0, m1_thesis = 0;
    for (let i = 0; i < 7; i++) {
      m0_thesis += S01[i] * W_MEAN[i] * DIAG_W[i];
      m1_thesis += S01[i] * W_VAR[i] * DIAG_W[i];
    }
    m0_thesis *= scaleFactor;
    m1_thesis *= scaleFactor * (1 + cv / 2);  // Adaptive tilt on var (thesis)
    // PSD corr proj (simple clamp; extend eigen if needed)
    m0_thesis = Math.max(-0.8, Math.min(0.8, m0_thesis));
    m1_thesis = Math.max(0, Math.min(1.5, m1_thesis));

    // Blend original m0/m1 with thesis for hybrid (preserve legacy; weight 0.5 thesis for SACO)
    const hybrid_m0 = 0.5 * m0 + 0.5 * m0_thesis;
    const hybrid_m1 = 0.5 * m1 + 0.5 * m1_thesis;

    return {
      moments: [hybrid_m0, hybrid_m1, m2, m3],
      explain: {
        sliders01: S01,
        linearMean: lin,
        probOR: por,
        blendT: t,
        correlations: BASE_R,
        // SACO:
        scaleFactor,
        cvAmp: cv,
        // UPDATE: SACO v1.1: Breakdown
        momentsBreakdown,
        // THESIS: Add thesis components for audit
        thesisMoments: { m0: m0_thesis, m1: m1_thesis },
        hybridBlend: 0.5
      }
    };
  } catch (err) {
    console.warn('Copula Moments Error:', err.message);
    return { moments: [0, 0, 0, 0], explain: { m0: 0, m1: 0, error: err.message } };
  }
}
