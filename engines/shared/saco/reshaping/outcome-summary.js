// Ported from system-google-sheets-addon/core/reshaping/outcome-summary.gs
// File: reshaping/outcome-summary.gs
// Build a compact textual + structured summary for reshaping outcomes.
// Cleaned for pure Apps Script - global scope, no Node.js

var NO_IMPROVEMENT_EPS = 1e-4;

function _os_pct(v) { return Number.isFinite(v) ? (v * 100).toFixed(2) + '%' : 'N/A'; }

// Renamed to avoid conflict with global num() in Code.gs
function outcomeNum(v, d = 2) { return Number.isFinite(v) ? Number(v).toFixed(d) : 'N/A'; }

function generateReshapingSummary(input = {}) {
  try {
    const {
      bf, sf, sc, sra, rp, rt, uc,
      originalProb, adjustedProb,
      targetValue, triangleMean, triangleStdDev,
    } = input;
    const hasBoth = Number.isFinite(originalProb) && Number.isFinite(adjustedProb);
    const deltaPts = hasBoth ? (adjustedProb - originalProb) * 100 : null;
    const noImprovement = !hasBoth || (adjustedProb <= originalProb + NO_IMPROVEMENT_EPS);
    const preface = noImprovement
      ? 'No improvement found — keeping baseline/last sliders. '
      : '';
    const text =
      `${preface}Target ${outcomeNum(targetValue, 0)} — baseline ${_os_pct(originalProb)}, ` +
      `reshaped ${_os_pct(adjustedProb)}` +
      (deltaPts !== null ? ` (Δ ${deltaPts.toFixed(2)} pts)` : '') +
      `. Sliders bf:${bf}, sf:${sf}, sc:${sc}, sra:${sra}, rp:${rp}, rt:${rt}, uc:${uc}. ` +
      `Triangle μ=${outcomeNum(triangleMean)}, σ=${outcomeNum(triangleStdDev)}.`;
    // Build a canonical object with all aliases, including flattened fields commonly
    // consumed by Sheets/readers that expect "Optimal …" (Title-Cased with spaces).
    const sliders = {
      budgetFlexibility: bf,
      scheduleFlexibility: sf,
      scopeCertainty: sc,
      scopeReductionAllowance: sra,
      reworkPercentage: rp,
      riskTolerance: rt,
      userConfidence: uc,
    };
    const out = {
      value: text,
      baselineProbability: originalProb,
      adjustedProbability: adjustedProb,
      deltaPoints: deltaPts,
      sliders,
      // Mirror aliases at this level for convenience:
      sliderValues: { ...sliders },
      optimizedSliders: { ...sliders },
      optimizedResult: {
        sliders: { ...sliders },
        sliderValues: { ...sliders },
        sliders01: {
          budgetFlexibility: (Number.isFinite(bf) ? bf : 0) / 100,
          scheduleFlexibility: (Number.isFinite(sf) ? sf : 0) / 100,
          scopeCertainty: (Number.isFinite(sc) ? sc : 0) / 100,
          scopeReductionAllowance: (Number.isFinite(sra) ? sra : 0) / 100,
          reworkPercentage: (Number.isFinite(rp) ? rp : 0) / 50, // domain-aware
          riskTolerance: (Number.isFinite(rt) ? rt : 0) / 100,
          userConfidence: (Number.isFinite(uc) ? uc : 0) / 100,
        }
      },
      // CamelCase flattened:
      optimalBudgetFlexibility: bf,
      optimalScheduleFlexibility: sf,
      optimalScopeCertainty: sc,
      optimalScopeReductionAllowance: sra,
      optimalReworkPercentage: rp,
      optimalRiskTolerance: rt,
      optimalUserConfidence: uc,
      // Title-Cased, space-separated flattened (for Sheets):
      'Optimal Budget Flexibility': bf,
      'Optimal Schedule Flexibility': sf,
      'Optimal Scope Certainty': sc,
      'Optimal Scope Reduction Allowance': sra,
      'Optimal Rework Percentage': rp,
      'Optimal Risk Tolerance': rt,
      'Optimal User Confidence': uc,
      triangle: { mean: triangleMean, stdDev: triangleStdDev },
      status: noImprovement ? 'no-change' : 'ok',
      error: null,
      details: {},
    };
    return out;
  } catch (e) {
    return {
      value: '',
      error: e && (e.message || e.error) ? (e.message || e.error) : 'Failed to build summary',
      details: e && e.details ? e.details : {},
    };
  }
}
