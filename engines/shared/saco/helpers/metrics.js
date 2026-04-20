// Ported from system-google-sheets-addon/core/helpers/metrics.gs
// File: helpers/metrics.gs
// Helpers: interpolation, metrics, CDF hygiene, validation, and integration utilities
// Cleaned for pure Apps Script - global scope, no Node.js, all functions available everywhere
// Updated Jan 16 2026: Added trapezoidIntegral (required for PDF normalization in monte-carlo-smoothed)

// -------------------
// Trapezoidal integration (used for PDF area normalization ∫pdf=1)
// -------------------
/**
 * Compute trapezoidal integral of points array (used for PDF normalization)
 * @param {Array<{x: number, y: number}>} points - Sorted points
 * @return {number} Area under the curve
 */
function trapezoidIntegral(points) {
  if (!Array.isArray(points) || points.length < 2) return 0;
  let area = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    if (!Number.isFinite(dx) || dx <= 0) continue; // skip invalid segments
    area += 0.5 * (points[i - 1].y + points[i].y) * dx;
  }
  return area;
}

/**
 * Ensure a proper CDF: [Step 1: Baseline cdf hygiene for p0/CV]
 *  - Sorts by x ascending
 *  - Dedupes identical x by keeping the MAX y at that x
 *  - Clamps y ∈ [0,1]
 *  - Enforces non-decreasing y
 *  - Snaps the final point's y to 1.0 (eliminate tail drift)
 * SACO: Used in Step 1 baseline hygiene (MC-smoothed cdf for p0); Step 5 interp for P'(τ) score.
 * Math: Monotone ensures KL computable (no violations); PMBOK Ch.6 quant: erf-slack feas via clamp.
 *
 * @param {Array<{x:number,y:number}>} cdfPoints
 * @returns {Array<{x:number,y:number}>}
 */
function ensureSortedMonotoneCdf(cdfPoints) {
  if (!Array.isArray(cdfPoints) || cdfPoints.length === 0) return [];

  // Filter invalids, sort by x, dedupe by keeping max y for identical x
  const byX = cdfPoints
    .filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y))
    .slice()
    .sort((a, b) => a.x - b.x)
    .reduce((acc, p) => {
      const n = acc.length;
      const x = Number(p.x);
      const y = Number(p.y);
      if (!n || acc[n - 1].x !== x) {
        acc.push({ x, y });
      } else {
        // same x: keep max y
        if (y > acc[n - 1].y) acc[n - 1].y = y;
      }
      return acc;
    }, []);

  if (byX.length === 0) return [];

  // Clamp y to [0,1] and enforce non-decreasing
  byX[0].y = Math.max(0, Math.min(1, byX[0].y));
  for (let i = 1; i < byX.length; i++) {
    const prev = byX[i - 1].y;
    let y = Math.max(0, Math.min(1, byX[i].y));
    if (y < prev) y = prev;
    byX[i].y = y;
  }

  // Snap last point to exactly 1.0 to avoid tail drift [Math: Ensures ∫pdf=1 for KL]
  byX[byX.length - 1].y = 1.0;

  return byX;
}

/**
 * Linear interpolation on a *proper* CDF points array. [Step 5: P'(τ) via lin interp post-refit]
 * Returns F(x) = P(X ≤ x).
 * @param {Array<{x:number,y:number}>} cdfPoints
 * @param {number} xVal
 * @returns {{ value: number }}
 */
function interpolateCdf(cdfPoints, xVal) {
  const out = { value: NaN };
  if (!Array.isArray(cdfPoints) || !Number.isFinite(xVal)) return out;

  const pts = ensureSortedMonotoneCdf(cdfPoints);
  const n = pts.length;
  if (n === 0) return out;

  if (xVal <= pts[0].x) { out.value = pts[0].y; return out; }
  if (xVal >= pts[n - 1].x) { out.value = pts[n - 1].y; return out; }

  // binary search for segment [lo, hi]
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (pts[mid].x <= xVal) lo = mid; else hi = mid;
  }

  const a = pts[lo], b = pts[hi];
  const dx = (b.x - a.x) || 1;
  const t = (xVal - a.x) / dx;

  // Interpolate and clamp to local segment's y-range to avoid tiny numeric violations [PMBOK Ch.6: erf-slack]
  let y = a.y + t * (b.y - a.y);
  if (y < a.y) y = a.y;
  if (y > b.y) y = b.y;

  out.value = Math.max(0, Math.min(1, y));
  return out;
}

/**
 * Quantile inversion helper on a hygienic CDF. [Step 6: Bootstrap CI via invert(0.025/0.975)]
 * p in [0,1] -> x where F(x)≈p (linear interpolation in y).
 */
function invertCdf(cdfPoints, p) {
  const cdf = ensureSortedMonotoneCdf(cdfPoints);
  if (cdf.length === 0) return NaN;

  const pp = Math.max(0, Math.min(1, Number(p)));
  if (pp <= cdf[0].y) return cdf[0].x;
  if (pp >= cdf[cdf.length - 1].y) return cdf[cdf.length - 1].x;

  for (let i = 1; i < cdf.length; i++) {
    const y0 = cdf[i - 1].y, y1 = cdf[i].y;
    if (pp >= y0 && pp <= y1) {
      const x0 = cdf[i - 1].x, x1 = cdf[i].x;
      const dy = (y1 - y0) || 1;
      const t = (pp - y0) / dy;
      return x0 + t * (x1 - x0);
    }
  }
  // Fallback (shouldn't happen with monotone y)
  return cdf[Math.floor(pp * (cdf.length - 1))].x;
}

/**
 * Baseline metrics: [Step 1: p0/CV/skew; Ch.7 reserves lo=15%/hi=70%]
 *  • PERT mean = (O + 4M + P)/6
 *  • CI from CDF quantiles (e.g. 95% => [2.5%, 97.5%]).
 *  • Optional widening with robustStd (±2*std), clamped to [O,P].
 * SACO: CV for m1 amp; robustStd for Step 6 bootstrap tie (5x resamples).
 */
function calculateMetrics(args) {
  const {
    optimistic, mostLikely, pessimistic,
    monteCarloSmoothed,
    confidenceLevel = 0.95,
    robustStd = 0
  } = args || {};

  const out = {
    pert: { mean: NaN },
    monteCarloSmoothed: { ci: { lower: NaN, upper: NaN } }
  };

  if ([optimistic, mostLikely, pessimistic].every(Number.isFinite)) {
    out.pert.mean = (optimistic + 4 * mostLikely + pessimistic) / 6;
  }

  const cdfRaw = Array.isArray(monteCarloSmoothed?.cdfPoints) ? monteCarloSmoothed.cdfPoints : [];
  if (cdfRaw.length >= 2) {
    const cdf = ensureSortedMonotoneCdf(cdfRaw);
    const alpha = Math.max(0, Math.min(1, Number(confidenceLevel)));
    const loQ = (1 - alpha) / 2;
    const hiQ = 1 - loQ;

    let ciLower = invertCdf(cdf, loQ);
    let ciUpper = invertCdf(cdf, hiQ);

    if (Number.isFinite(robustStd) && robustStd > 0) {
      ciLower = Math.max(optimistic, ciLower - 2 * robustStd);
      ciUpper = Math.min(pessimistic, ciUpper + 2 * robustStd);
    }

    out.monteCarloSmoothed.ci.lower = ciLower;
    out.monteCarloSmoothed.ci.upper = ciUpper;
  }

  return out;
}
