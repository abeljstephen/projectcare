// Ported from system-google-sheets-addon/core/visuals/annotations.gs
// File: visuals/annotations.gs
// Return values at τ for available series so the UI can draw annotated circles
// consistently (no per-client interpolation drift).
// Cleaned for pure Apps Script - global scope, no Node.js

/**
 * Return values at τ for available series so the UI can draw annotated circles
 * consistently (no per-client interpolation drift).
 *
 * Input series structure:
 *   {
 *     triangle: { pdf: [{x,y}], cdf: [{x,y}] },
 *     betaPert: { pdf: [...], cdf: [...] },
 *     baseline: { pdf: [...], cdf: [...] },
 *     adjusted: { pdf: [...], cdf: [...] },
 *     optimized:{ pdf: [...], cdf: [...] }
 *   }
 *
 * We compute:
 *   - CDF(τ) via linear interpolation
 *   - PDF(τ) via linear interpolation on pdfPoints
 *
 * @param {Object} args
 * @param {number|null|undefined} args.tau
 * @param {Object} args.series
 * @returns {{ tau:number|null, atTau:Record<string,{pdf:number|null,cdf:number|null}> }}
 */
function buildAnnotations({ tau, series }) {
  const t = Number.isFinite(tau) ? Number(tau) : null;
  const out = { tau: t, atTau: {} };

  const interp = (points, x) => {
    if (!Array.isArray(points) || points.length < 2 || !Number.isFinite(x)) return null;
    // assume points sorted by x (most of core already guarantees)
    // clamp outside range to edge values (consistent, predictable)
    if (x <= points[0].x) return Number(points[0].y);
    if (x >= points[points.length - 1].x) return Number(points[points.length - 1].y);
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      if (a.x <= x && x <= b.x) {
        const dx = (b.x - a.x) || 1e-12;
        const t = (x - a.x) / dx;
        return Number(a.y + t * (b.y - a.y));
      }
    }
    return null;
  };

  const keys = Object.keys(series || {});
  for (const k of keys) {
    const s = series[k] || {};
    const pdf = interp(s.pdf || [], t);
    const cdf = interp(s.cdf || [], t);
    out.atTau[k] = {
      pdf: Number.isFinite(pdf) ? pdf : null,
      cdf: Number.isFinite(cdf) ? cdf : null
    };
  }

  return out;
}
