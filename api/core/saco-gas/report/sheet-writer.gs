// File: report/sheet-writer.gs
// Writes PMC Snapshot or Full Report to a new tab in the active spreadsheet.
// Called by Plot.html via google.script.run.pcWriteReportTab(payload, mode).
// invertCdf / ensureSortedMonotoneCdf are available globally from helpers/metrics.gs.

// ── Colour palette ───────────────────────────────────────────────────────────
var SW_COLOURS_ = {
  title:        { bg: '#1E3A5F', fg: '#FFFFFF' },
  section:      {
    context:    { bg: '#E2E8F0', fg: '#334155' },
    inputs:     { bg: '#DBEAFE', fg: '#1E40AF' },
    pert:       { bg: '#FDE68A', fg: '#78350F' },   // amber — "the highlight"
    probability:{ bg: '#D1FAE5', fg: '#065F46' },
    percentiles:{ bg: '#EDE9FE', fg: '#4C1D95' },
    conditions: { bg: '#FFEDD5', fg: '#7C2D12' },
    diagnostics:{ bg: '#FFE4E6', fg: '#881337' },
    recommend:  { bg: '#CCFBF1', fg: '#134E4A' }
  },
  data: {
    context:    '#F8FAFC',
    inputs:     '#EFF6FF',
    pert:       '#FEF9C3',   // light amber — matches section header
    probability:'#F0FDF4',
    percentiles:'#FAF5FF',
    conditions: '#FFF7ED',
    diagnostics:'#FFF1F2',
    recommend:  '#F0FDFA'
  },
  altRow:       '#FAFAFA'    // alternate rows in data area
};

// ── Utility helpers ──────────────────────────────────────────────────────────
function swFmt_(v, decimals) {
  if (v === null || v === undefined || (typeof v === 'number' && !isFinite(v))) return '';
  if (typeof v === 'number') return Number(v.toFixed(decimals != null ? decimals : 2));
  return v;
}

function swPct_(v) {
  if (v === null || v === undefined || (typeof v === 'number' && !isFinite(v))) return '';
  return (Number(v) * 100).toFixed(1) + '%';
}

function swDate_(iso) {
  if (!iso) return '';
  try {
    var d = new Date(iso);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    return Utilities.formatDate(d, ss.getSpreadsheetTimeZone(), 'MMM d, yyyy  HH:mm');
  } catch(e) { return iso; }
}

function swInvertCdf_(cdfArr, p) {
  // cdfArr is array of {x, y} from client — mirrors invertCdf in metrics.gs
  if (!Array.isArray(cdfArr) || !cdfArr.length) return null;
  var cdf = cdfArr.slice().sort(function(a,b){ return a.x - b.x; });
  var pp = Math.max(0, Math.min(1, Number(p)));
  if (pp <= cdf[0].y) return cdf[0].x;
  if (pp >= cdf[cdf.length-1].y) return cdf[cdf.length-1].x;
  for (var i = 1; i < cdf.length; i++) {
    var y0 = cdf[i-1].y, y1 = cdf[i].y;
    if (pp >= y0 && pp <= y1) {
      var x0 = cdf[i-1].x, x1 = cdf[i].x;
      var dy = (y1 - y0) || 1;
      return x0 + (pp - y0) / dy * (x1 - x0);
    }
  }
  return cdf[cdf.length-1].x;
}

function swPercentiles_(cdf) {
  if (!cdf || !cdf.length) return { p10:null, p25:null, p50:null, p75:null, p80:null, p90:null, p95:null };
  return {
    p10: swInvertCdf_(cdf, 0.10),
    p25: swInvertCdf_(cdf, 0.25),
    p50: swInvertCdf_(cdf, 0.50),
    p75: swInvertCdf_(cdf, 0.75),
    p80: swInvertCdf_(cdf, 0.80),
    p90: swInvertCdf_(cdf, 0.90),
    p95: swInvertCdf_(cdf, 0.95)
  };
}

function swBestStrategy_(bm, unc, yc) {
  var best = null, name = '';
  if (bm != null && (best === null || bm > best)) { best = bm; name = 'Benchmarked Optimization'; }
  if (unc != null && (best === null || unc > best)) { best = unc; name = 'Unconstrained Optimization'; }
  if (yc != null && (best === null || yc > best)) { best = yc; name = 'Your Conditions'; }
  return { prob: best, name: name };
}

function swSlider_(sliders, key) {
  if (!sliders || sliders[key] == null) return '';
  var v = Number(sliders[key]);
  if (!isFinite(v)) return '';
  // Convert 0-1 internal to UI display value
  if (key === 'reworkPercentage') return swFmt_(v * 50, 1);   // 0-50 domain
  return swFmt_(v * 100, 1);                                    // 0-100 domain
}

// ── Sheet formatting helpers ─────────────────────────────────────────────────
function swApplyTitle_(sheet, totalCols, label) {
  var titleRange = sheet.getRange(1, 1, 1, totalCols);
  titleRange.merge()
    .setValue(label)
    .setBackground(SW_COLOURS_.title.bg)
    .setFontColor(SW_COLOURS_.title.fg)
    .setFontWeight('bold')
    .setFontSize(12)
    .setVerticalAlignment('middle')
    .setHorizontalAlignment('left')
    .setNumberFormat('@');   // plain text
  sheet.setRowHeight(1, 32);
}

function swApplySectionBand_(sheet, row, col, span, sectionKey) {
  var c = SW_COLOURS_.section[sectionKey] || { bg: '#F1F5F9', fg: '#334155' };
  var r = sheet.getRange(row, col, 1, span);
  r.merge()
    .setValue(sectionKey.toUpperCase())
    .setBackground(c.bg)
    .setFontColor(c.fg)
    .setFontWeight('bold')
    .setFontSize(8)
    .setVerticalAlignment('middle')
    .setHorizontalAlignment('left');
}

function swApplyHeaderRow_(sheet, headerRow, headers, notes, bgPerCol) {
  for (var i = 0; i < headers.length; i++) {
    var cell = sheet.getRange(headerRow, i + 1);
    cell.setValue(headers[i])
        .setBackground(bgPerCol[i])
        .setFontWeight('bold')
        .setFontSize(9)
        .setWrap(true)
        .setVerticalAlignment('bottom');
    if (notes && notes[i]) cell.setNote(notes[i]);
  }
  sheet.setRowHeight(headerRow, 56);
}

function swApplyDataRow_(sheet, dataRow, values, bgPerCol) {
  for (var i = 0; i < values.length; i++) {
    var cell = sheet.getRange(dataRow, i + 1);
    var v = values[i];
    if (v === null || v === undefined || v === '') {
      cell.setValue('—');
    } else {
      cell.setValue(v);
    }
    cell.setBackground(bgPerCol[i])
        .setFontSize(10)
        .setVerticalAlignment('middle');
  }
  sheet.setRowHeight(dataRow, 24);
}

function swFinishSheet_(sheet, totalCols, colWidths) {
  // Freeze: title row + section band row + header row = 3 rows
  sheet.setFrozenRows(3);
  // Column widths
  for (var i = 0; i < colWidths.length; i++) {
    sheet.setColumnWidth(i + 1, colWidths[i]);
  }
  // Border around data block
  var used = sheet.getLastRow();
  if (used >= 4) {
    sheet.getRange(4, 1, used - 3, totalCols)
         .setBorder(null, null, true, null, null, null, '#CBD5E1', SpreadsheetApp.BorderStyle.SOLID);
  }
}

// ── Snapshot (15 columns) ────────────────────────────────────────────────────
function _pmcWriteSnapshot_(sheet, p, runDate) {
  // Use pre-computed percentiles from client (avoids large CDF payload), fall back to server compute
  var pct = p.basePct || swPercentiles_(p.baseCdf || []);
  var best = swBestStrategy_(p.benchmarkedProb, p.unconstrainedProb, p.yourConditionsProb);
  var p90 = pct.p90;
  var p90h = (p90 != null && p.target != null) ? (p90 - p.target) : null;
  var gain = (best.prob != null && p.baselineProb != null) ? (best.prob - p.baselineProb) : null;

  // ── Column order (15 cols, agreed design):
  // 1  Run Date       2  Task Name       3  Mode
  // 4  O              5  M               6  P               7  Target
  // 8  PERT Mean      9  PERT Std Dev
  // 10 P90           11  P90 Headroom
  // 12 Baseline P    13  Best Strategy  14  Prob Gain
  // 15 Top Recommendation

  var sections = [
    { label: 'RUN CONTEXT',           col:  1, span: 3, key: 'context'     },
    { label: 'INPUTS',                col:  4, span: 4, key: 'inputs'      },
    { label: 'PERT DISTRIBUTION',     col:  8, span: 2, key: 'pert'        },
    { label: 'P90 CONFIDENCE',        col: 10, span: 2, key: 'percentiles' },
    { label: 'PROBABILITY AT TARGET', col: 12, span: 3, key: 'probability' },
    { label: 'RECOMMENDATION',        col: 15, span: 1, key: 'recommend'   }
  ];

  var headers = [
    // Context (1-3)
    'Run Date', 'Task Name', 'Mode',
    // Inputs (4-7)
    'O  Optimistic', 'M  Most Likely', 'P  Pessimistic', 'Target Value',
    // PERT (8-9)
    'PERT Mean', 'PERT Std Dev',
    // P90 (10-11)
    'P90 Value', 'P90 Headroom\n(P90 − Target)',
    // Probability (12-14)
    'Baseline\nP(≤ Target)', 'Best Strategy', 'Probability Gain',
    // Recommendation (15)
    'Top Recommendation'
  ];

  var notes = [
    // Context
    'When this report was written. Track across project phases to see estimate evolution.',
    'Task or work package. In Group mode this is the aggregate of all active tasks.',
    'Single-task or Group aggregate mode.',
    // Inputs
    'Optimistic / best-case estimate (O). Never use this as your plan number.',
    'Most-likely estimate (M). Carries 4× weight in PERT formula.',
    'Pessimistic / worst-case estimate (P). Upper bound — significant setbacks, not catastrophe.',
    'The cost or schedule threshold you are trying to achieve. All probability columns reference this number.',
    // PERT
    'PERT Mean = (O + 4M + P) / 6  — risk-adjusted estimate. Use this instead of M when committing to stakeholders.',
    'PERT Std Dev = (P − O) / 6  — spread of the distribution. If > 15% of PERT Mean, flag for closer scrutiny.',
    // P90
    'P90 — 90% confidence threshold. Use for contingency reserves, contract ceilings, or schedule buffers when high confidence is required.',
    'P90 minus Target. Negative means your high-confidence value already exceeds target — the target sits in the risky tail.',
    // Probability
    'Probability of meeting target with no management conditions applied. Starting point before any optimization.',
    'Which strategy (Benchmarked / Unconstrained / Your Conditions) produced the highest probability at target.',
    'Best Strategy probability minus Baseline. How much optimization moved the needle. Near zero = target may be structurally unreachable.',
    // Recommendation
    'The single highest-impact action given your current inputs. A starting point for team discussion, not a prescription.'
  ];

  var C = SW_COLOURS_.data;
  var bgPerCol = [
    // Context (1-3)
    C.context, C.context, C.context,
    // Inputs (4-7)
    C.inputs, C.inputs, C.inputs, C.inputs,
    // PERT (8-9)
    C.pert, C.pert,
    // P90 (10-11)
    C.percentiles, C.percentiles,
    // Probability (12-14)
    C.probability, C.probability, C.probability,
    // Recommendation (15)
    C.recommend
  ];

  var pertMean = ((p.O || 0) + 4*(p.M || 0) + (p.P || 0)) / 6;
  var pertStd  = ((p.P || 0) - (p.O || 0)) / 6;

  var values = [
    // Context
    swDate_(runDate ? runDate.toISOString() : new Date().toISOString()),
    p.taskName || '',
    p.mode === 'aggregate' ? 'Group' : 'Single',
    // Inputs
    swFmt_(p.O, 2), swFmt_(p.M, 2), swFmt_(p.P, 2),
    p.target != null ? swFmt_(p.target, 2) : '',
    // PERT
    swFmt_(pertMean, 2),
    swFmt_(pertStd, 2),
    // P90
    p90  != null ? swFmt_(p90, 2)  : '',
    p90h != null ? swFmt_(p90h, 2) : '',
    // Probability
    p.baselineProb != null ? swPct_(p.baselineProb) : '',
    best.name || '',
    gain != null ? swPct_(gain) : '',
    // Recommendation
    p.topRecommendation || ''
  ];

  var totalCols = headers.length;
  swApplyTitle_(sheet, totalCols,
    'ProjectCare — Snapshot   |   ' + (p.taskName || 'Task') +
    '   |   ' + swDate_(runDate ? runDate.toISOString() : new Date().toISOString()));

  // Row 2: section band (using merged spans per section)
  // Fill entire row with neutral bg first
  sheet.getRange(2, 1, 1, totalCols).setBackground('#E2E8F0');
  // Now paint each section's label over its span
  for (var s = 0; s < sections.length; s++) {
    var sec = sections[s];
    var c2 = SW_COLOURS_.section[sec.key] || SW_COLOURS_.section.context;
    sheet.getRange(2, sec.col, 1, sec.span)
         .merge()
         .setValue(sec.label)
         .setBackground(c2.bg)
         .setFontColor(c2.fg)
         .setFontWeight('bold')
         .setFontSize(8)
         .setHorizontalAlignment('left')
         .setVerticalAlignment('middle');
  }
  sheet.setRowHeight(2, 18);

  swApplyHeaderRow_(sheet, 3, headers, notes, bgPerCol);
  swApplyDataRow_(sheet, 4, values, bgPerCol);

  swFinishSheet_(sheet, totalCols,
    // 1:RunDate  2:TaskName  3:Mode  4:O  5:M  6:P  7:Target
    // 8:PERTMean 9:PERTStd  10:P90 11:P90Head 12:BaseP 13:BestStrat 14:ProbGain 15:TopRec
    [120, 160, 65, 70, 70, 70, 75, 82, 82, 75, 95, 78, 150, 80, 240]);
}

// ── Full Report (38 columns) ─────────────────────────────────────────────────
function _pmcWriteFullReport_(sheet, p, runDate) {
  var pct = p.basePct || swPercentiles_(p.baseCdf || []);
  var best = swBestStrategy_(p.benchmarkedProb, p.unconstrainedProb, p.yourConditionsProb);
  var p90 = pct.p90;
  var p90h = (p90 != null && p.target != null) ? (p90 - p.target) : null;
  var gain = (best.prob != null && p.baselineProb != null) ? (best.prob - p.baselineProb) : null;
  var pertMean = ((p.O || 0) + 4*(p.M || 0) + (p.P || 0)) / 6;
  var pertStd  = ((p.P || 0) - (p.O || 0)) / 6;
  var pertRange = (p.P || 0) - (p.O || 0);

  // Best KL: use whichever strategy won
  var bestKL = null;
  if (best.name === 'Benchmarked Optimization') bestKL = p.benchmarkedKL;
  else if (best.name === 'Unconstrained Optimization') bestKL = p.unconstrainedKL;
  else if (best.name === 'Your Conditions') bestKL = p.yourConditionsKL;

  // Sliders: prefer winning strategy's slider set for display
  var bestSliders = null;
  if (best.name === 'Benchmarked Optimization') bestSliders = p.benchmarkedSliders;
  else if (best.name === 'Unconstrained Optimization') bestSliders = p.unconstrainedSliders;
  else if (best.name === 'Your Conditions') bestSliders = p.yourConditionsSliders;

  // Section layout: [label, startCol(1-based), span, colourKey]
  var sections = [
    { label: 'RUN CONTEXT',           col:  1, span: 4, key: 'context'     },
    { label: 'INPUTS',                col:  5, span: 4, key: 'inputs'      },
    { label: 'PERT DISTRIBUTION',     col:  9, span: 3, key: 'pert'        },
    { label: 'PROBABILITY AT TARGET', col: 12, span: 6, key: 'probability' },
    { label: 'DISTRIBUTION PERCENTILES', col:18, span: 8, key: 'percentiles'},
    { label: 'MANAGEMENT CONDITIONS', col: 26, span: 7, key: 'conditions'  },
    { label: 'MODEL DIAGNOSTICS',     col: 33, span: 4, key: 'diagnostics' },
    { label: 'RECOMMENDATIONS',       col: 37, span: 2, key: 'recommend'   }
  ];

  var headers = [
    // Context (1-4)
    'Run Date', 'Mode', 'Task Count', 'Task Name',
    // Inputs (5-8)
    'O  Optimistic', 'M  Most Likely', 'P  Pessimistic', 'Target Value',
    // PERT (9-11)
    'PERT Mean', 'PERT Std Dev', 'PERT Range\n(P − O)',
    // Probability (12-17)
    'Baseline\nP(≤ Target)',
    'Benchmarked Opt\nP(≤ Target)',
    'Unconstrained Opt\nP(≤ Target)',
    'Your Conditions\nP(≤ Target)',
    'Best Strategy',
    'Probability Gain',
    // Percentiles (18-25)
    'P10', 'P25', 'P50\nMedian', 'P75', 'P80', 'P90', 'P90 Headroom\n(P90 − Target)', 'P95',
    // Conditions (26-32)
    'Budget\nFlexibility', 'Schedule\nFlexibility', 'Scope\nCertainty',
    'Scope Reduction\nAllowance', 'Rework %', 'Risk\nTolerance', 'User\nConfidence',
    // Diagnostics (33-36)
    'KL Divergence', 'RCF Applied', 'RCF  n\n(# Projects)', 'RCF Mean\nOverrun',
    // Recommendations (37-38)
    'Playbook Flags', 'Top Recommendation'
  ];

  var notes = [
    // Context
    'When this report was written. Track across project phases to see how estimates evolve.',
    'Single-task or Group aggregate. Group mode combines all active tasks into one distribution.',
    'Number of active tasks included. Only meaningful in Group mode.',
    'Task or work package estimated. In Group mode this is the aggregate label.',
    // Inputs
    'Optimistic / best-case (O). Lower bound of the distribution. Never use as your plan number.',
    'Most-likely estimate (M). Carries 4× weight in PERT formula — drives the mean more than O or P.',
    'Pessimistic / worst-case (P). Upper bound — significant setbacks, not catastrophe.',
    'The cost or schedule threshold you are trying to achieve. All probability columns reference this number.',
    // PERT
    'PERT Mean = (O + 4M + P) / 6  — risk-adjusted, probability-weighted estimate. Use instead of M when committing to stakeholders.',
    'PERT Std Dev = (P − O) / 6  — spread. If > 15% of PERT Mean, flag this task for closer scrutiny before committing.',
    'PERT Range = P − O — full spread between best and worst case. A quick proxy for estimate maturity. Wide = early-stage uncertainty.',
    // Probability
    'Probability of meeting target with no management conditions applied. Starting point before any optimization.',
    'Probability after SACO optimization within PMBOK/CII-anchored bounds. Most defensible to stakeholders and auditors.',
    'Probability after optimization with no benchmark anchors — wider search space. Theoretical ceiling; achieving it may require unusual management actions.',
    'Probability using the slider values you manually set. Reflects your team\'s specific stance.',
    'Which strategy (Benchmarked / Unconstrained / Your Conditions) produced the highest P(≤ Target).',
    'Best Strategy probability minus Baseline. How much optimization moved the needle. Near zero = target may be structurally unreachable.',
    // Percentiles
    '10th percentile — 10% chance outcome falls at or below this. Useful for upside ceiling in opportunity conversations.',
    '25th percentile (lower quartile) — 1 in 4 outcomes expected at or below. Useful as an early-win threshold.',
    '50th percentile (median) — midpoint of the distribution. Differs from PERT Mean when skewed. Use Mean for financial commitments; P50 for symmetric risk conversations.',
    '75th percentile (upper quartile) — 3 in 4 outcomes expected at or below. Practical for internal budget planning.',
    '80th percentile — common reserve-setting baseline in PM practice. Compare against P90 to see cost of last 10% confidence.',
    '90th percentile — 90% confidence threshold. Use for contingency reserves, contract ceilings, or schedule buffers.',
    'P90 minus Target. Negative = your high-confidence value already exceeds target — target sits in the risky tail.',
    '95th percentile — extreme contingency threshold. Only 1 in 20 outcomes expected to exceed this. Use for contract caps or board-level worst-case disclosures.',
    // Conditions — displayed as 0-100 (or 0-50 for Rework)
    'Budget Flexibility (0–100). Team ability to absorb cost overruns without renegotiating scope or schedule.',
    'Schedule Flexibility (0–100). Tolerance for timeline extension before stakeholder impact becomes critical.',
    'Scope Certainty (0–100). Confidence that defined scope is stable and complete. Low = high change-order risk.',
    'Scope Reduction Allowance (0–100). How much scope could be cut to meet cost/schedule targets — a lever many teams underutilize.',
    'Rework % (0–50). Expected proportion of work requiring rework. Directly inflates effective cost and schedule.',
    'Risk Tolerance (0–100). Team appetite for outcome variance. Higher = optimizer can pursue solutions with more spread.',
    'User Confidence (0–100). Subjective confidence in O/M/P accuracy. Lower = model widens distribution before optimizing.',
    // Diagnostics
    'KL Divergence — how much the optimized distribution diverged from the baseline shape. Near 0 = minimal reshaping. > 1 = verify conditions are realistic.',
    'Whether Reference Class Forecasting data was used to shift the baseline before optimization.',
    'Number of historical projects in the reference class. < 10 = indicative only.',
    'Average overrun fraction in the reference class (e.g. 0.20 = 20% over on average). Shifts the baseline distribution upward.',
    // Recommendations
    'Diagnostic flags raised by the model — e.g. high spread, low scope certainty, rework above norm. Each maps to a recommended management action.',
    'The single highest-impact action given your current inputs and slider state. Starting point for team discussion, not a prescription.'
  ];

  var C = SW_COLOURS_.data;
  var bgPerCol = [
    // Context (1-4)
    C.context, C.context, C.context, C.context,
    // Inputs (5-8)
    C.inputs, C.inputs, C.inputs, C.inputs,
    // PERT (9-11)
    C.pert, C.pert, C.pert,
    // Probability (12-17)
    C.probability, C.probability, C.probability, C.probability, C.probability, C.probability,
    // Percentiles (18-25)
    C.percentiles, C.percentiles, C.percentiles, C.percentiles,
    C.percentiles, C.percentiles, C.percentiles, C.percentiles,
    // Conditions (26-32)
    C.conditions, C.conditions, C.conditions, C.conditions,
    C.conditions, C.conditions, C.conditions,
    // Diagnostics (33-36)
    C.diagnostics, C.diagnostics, C.diagnostics, C.diagnostics,
    // Recommendations (37-38)
    C.recommend, C.recommend
  ];

  var playbookText = Array.isArray(p.playbookFlags) ? p.playbookFlags.join('; ') : (p.playbookFlags || '');

  var values = [
    // Context
    swDate_(runDate ? runDate.toISOString() : new Date().toISOString()),
    p.mode === 'aggregate' ? 'Group' : 'Single',
    p.taskCount != null ? p.taskCount : 1,
    p.taskName || '',
    // Inputs
    swFmt_(p.O, 2), swFmt_(p.M, 2), swFmt_(p.P, 2),
    p.target != null ? swFmt_(p.target, 2) : '',
    // PERT
    swFmt_(pertMean, 2),
    swFmt_(pertStd, 2),
    swFmt_(pertRange, 2),
    // Probability
    p.baselineProb    != null ? swPct_(p.baselineProb)    : '',
    p.benchmarkedProb != null ? swPct_(p.benchmarkedProb) : '',
    p.unconstrainedProb != null ? swPct_(p.unconstrainedProb) : '',
    p.yourConditionsProb != null ? swPct_(p.yourConditionsProb) : '',
    best.name || '',
    gain != null ? swPct_(gain) : '',
    // Percentiles
    pct.p10 != null ? swFmt_(pct.p10, 2) : '',
    pct.p25 != null ? swFmt_(pct.p25, 2) : '',
    pct.p50 != null ? swFmt_(pct.p50, 2) : '',
    pct.p75 != null ? swFmt_(pct.p75, 2) : '',
    pct.p80 != null ? swFmt_(pct.p80, 2) : '',
    p90     != null ? swFmt_(p90, 2)     : '',
    p90h    != null ? swFmt_(p90h, 2)    : '',
    pct.p95 != null ? swFmt_(pct.p95, 2) : '',
    // Conditions (winning strategy sliders, UI scale)
    swSlider_(bestSliders, 'budgetFlexibility'),
    swSlider_(bestSliders, 'scheduleFlexibility'),
    swSlider_(bestSliders, 'scopeCertainty'),
    swSlider_(bestSliders, 'scopeReductionAllowance'),
    swSlider_(bestSliders, 'reworkPercentage'),
    swSlider_(bestSliders, 'riskTolerance'),
    swSlider_(bestSliders, 'userConfidence'),
    // Diagnostics
    bestKL != null ? swFmt_(bestKL, 4) : '',
    p.rcfApplied ? 'Yes' : 'No',
    p.rcfN != null ? p.rcfN : '',
    p.rcfMeanOverrun != null ? swPct_(p.rcfMeanOverrun) : '',
    // Recommendations
    playbookText,
    p.topRecommendation || ''
  ];

  var totalCols = headers.length; // 38

  swApplyTitle_(sheet, totalCols,
    'ProjectCare — Full Report   |   ' + (p.taskName || 'Task') +
    '   |   ' + swDate_(runDate ? runDate.toISOString() : new Date().toISOString()));

  // Row 2: section bands
  sheet.getRange(2, 1, 1, totalCols).setBackground('#E2E8F0');
  for (var s = 0; s < sections.length; s++) {
    var sec = sections[s];
    var sc = SW_COLOURS_.section[sec.key] || SW_COLOURS_.section.context;
    sheet.getRange(2, sec.col, 1, sec.span)
         .merge()
         .setValue(sec.label)
         .setBackground(sc.bg)
         .setFontColor(sc.fg)
         .setFontWeight('bold')
         .setFontSize(8)
         .setHorizontalAlignment('left')
         .setVerticalAlignment('middle');
  }
  sheet.setRowHeight(2, 18);

  swApplyHeaderRow_(sheet, 3, headers, notes, bgPerCol);
  swApplyDataRow_(sheet, 4, values, bgPerCol);

  swFinishSheet_(sheet, totalCols, [
    // Context: Run Date, Mode, Count, Task Name
    120, 65, 55, 160,
    // Inputs: O, M, P, Target
    68, 68, 68, 80,
    // PERT: Mean, Std, Range
    80, 80, 75,
    // Probability: 6 cols
    80, 90, 95, 90, 145, 80,
    // Percentiles: 8 cols
    68, 68, 68, 68, 68, 68, 95, 68,
    // Conditions: 7 cols
    72, 72, 72, 90, 68, 68, 68,
    // Diagnostics: 4 cols
    85, 75, 75, 85,
    // Recommendations: 2 cols
    220, 280
  ]);
}

// ── Batch Snapshot (15-col condensed, one row per task) ──────────────────────
function pcWriteBatchSnapshotTab_(payloads, taskCount, runDate) {
  if (!Array.isArray(payloads) || payloads.length === 0) return;
  try {
    var ss      = SpreadsheetApp.getActiveSpreadsheet();
    var tz      = ss.getSpreadsheetTimeZone();
    var now     = runDate || new Date();
    var dateStr = Utilities.formatDate(now, tz, 'MMM d, yyyy  HH:mm');
    var tabName = 'ProjectCare \u2014 Batch Snapshot \u2014 ' + dateStr;

    var existing = ss.getSheetByName(tabName);
    if (existing) { try { ss.deleteSheet(existing); } catch(_) {} }
    var sheet = ss.insertSheet(tabName);

    var totalCols = 15;
    var sections = [
      { label: 'RUN CONTEXT',           col:  1, span: 3, key: 'context'     },
      { label: 'INPUTS',                col:  4, span: 4, key: 'inputs'      },
      { label: 'PERT DISTRIBUTION',     col:  8, span: 2, key: 'pert'        },
      { label: 'P90 CONFIDENCE',        col: 10, span: 2, key: 'percentiles' },
      { label: 'PROBABILITY AT TARGET', col: 12, span: 3, key: 'probability' },
      { label: 'RECOMMENDATION',        col: 15, span: 1, key: 'recommend'   }
    ];
    var headers = [
      'Run Date', 'Task Name', 'Mode',
      'O  Optimistic', 'M  Most Likely', 'P  Pessimistic', 'Target Value',
      'PERT Mean', 'PERT Std Dev',
      'P90 Value', 'P90 Headroom\n(P90 \u2212 Target)',
      'Baseline\nP(\u2264 Target)', 'Best Strategy', 'Probability Gain',
      'Top Recommendation'
    ];
    var C = SW_COLOURS_.data;
    var bgPerCol = [
      C.context, C.context, C.context,
      C.inputs,  C.inputs,  C.inputs,  C.inputs,
      C.pert,    C.pert,
      C.percentiles, C.percentiles,
      C.probability, C.probability, C.probability,
      C.recommend
    ];

    // Row 1: title
    swApplyTitle_(sheet, totalCols,
      'ProjectCare \u2014 Batch Snapshot   |   ' +
      payloads.length + ' task' + (payloads.length !== 1 ? 's' : '') +
      '   |   ' + dateStr);

    // Row 2: section bands
    sheet.getRange(2, 1, 1, totalCols).setBackground('#E2E8F0');
    for (var s = 0; s < sections.length; s++) {
      var sec = sections[s];
      var sc  = SW_COLOURS_.section[sec.key] || SW_COLOURS_.section.context;
      sheet.getRange(2, sec.col, 1, sec.span)
           .merge()
           .setValue(sec.label)
           .setBackground(sc.bg).setFontColor(sc.fg)
           .setFontWeight('bold').setFontSize(8)
           .setHorizontalAlignment('left').setVerticalAlignment('middle');
    }
    sheet.setRowHeight(2, 18);

    // Row 3: headers
    swApplyHeaderRow_(sheet, 3, headers, null, bgPerCol);

    // Rows 4+: one row per task
    for (var t = 0; t < payloads.length; t++) {
      var p    = payloads[t];
      var pct  = p.basePct || swPercentiles_(p.baseCdf || []);
      var best = swBestStrategy_(p.benchmarkedProb, p.unconstrainedProb, p.yourConditionsProb);
      var p90  = pct.p90;
      var p90h = (p90 != null && p.target != null) ? (p90 - p.target) : null;
      var gain = (best.prob != null && p.baselineProb != null) ? (best.prob - p.baselineProb) : null;
      var pertMean = ((p.O || 0) + 4*(p.M || 0) + (p.P || 0)) / 6;
      var pertStd  = ((p.P || 0) - (p.O || 0)) / 6;

      var values = [
        swDate_(now.toISOString()), p.taskName || '', 'Batch',
        swFmt_(p.O, 2), swFmt_(p.M, 2), swFmt_(p.P, 2),
        p.target != null ? swFmt_(p.target, 2) : '',
        swFmt_(pertMean, 2), swFmt_(pertStd, 2),
        p90  != null ? swFmt_(p90, 2)  : '',
        p90h != null ? swFmt_(p90h, 2) : '',
        p.baselineProb != null ? swPct_(p.baselineProb) : '',
        best.name || '',
        gain != null ? swPct_(gain) : '',
        p.topRecommendation || ''
      ];

      var rowBg = (t % 2 === 0) ? bgPerCol : bgPerCol.map(function() { return SW_COLOURS_.altRow; });
      swApplyDataRow_(sheet, 4 + t, values, rowBg);
    }

    swFinishSheet_(sheet, totalCols, [120, 160, 65, 70, 70, 70, 75, 82, 82, 75, 95, 78, 150, 80, 240]);

    ss.setActiveSheet(sheet);
    return { ok: true, tabName: tabName };
  } catch(e) {
    console.log('pcWriteBatchSnapshotTab_ error: ' + e.message);
    return { ok: false, error: e.message };
  }
}

// ── Batch Full Report (multi-row, one tab for all tasks from a batch run) ────
// Called by runTasks_() in Code.gs after all tasks complete.
// payloads: array of report payload objects (one per task).
// Each payload must have: taskName, O, M, P, target, baselineProb, baseCdf,
//   unconstrainedProb, unconstrainedSliders (0-1), unconstrainedKL,
//   topRecommendation, playbookFlags, taskCount.
function pcWriteBatchReportTab_(payloads, taskCount, runDate) {
  if (!Array.isArray(payloads) || payloads.length === 0) return;
  try {
    var ss      = SpreadsheetApp.getActiveSpreadsheet();
    var tz      = ss.getSpreadsheetTimeZone();
    var now     = runDate || new Date();
    var dateStr = Utilities.formatDate(now, tz, 'MMM d, yyyy  HH:mm');
    var tabName = 'ProjectCare \u2014 Batch Report \u2014 ' + dateStr;

    var existing = ss.getSheetByName(tabName);
    if (existing) { try { ss.deleteSheet(existing); } catch(_) {} }
    var sheet = ss.insertSheet(tabName);

    var totalCols = 38;
    var sections = [
      { label: 'RUN CONTEXT',              col:  1, span:  4, key: 'context'     },
      { label: 'INPUTS',                   col:  5, span:  4, key: 'inputs'      },
      { label: 'PERT DISTRIBUTION',        col:  9, span:  3, key: 'pert'        },
      { label: 'PROBABILITY AT TARGET',    col: 12, span:  6, key: 'probability' },
      { label: 'DISTRIBUTION PERCENTILES', col: 18, span:  8, key: 'percentiles' },
      { label: 'MANAGEMENT CONDITIONS',    col: 26, span:  7, key: 'conditions'  },
      { label: 'MODEL DIAGNOSTICS',        col: 33, span:  4, key: 'diagnostics' },
      { label: 'RECOMMENDATIONS',          col: 37, span:  2, key: 'recommend'   }
    ];
    var headers = [
      'Run Date', 'Mode', 'Task Count', 'Task Name',
      'O  Optimistic', 'M  Most Likely', 'P  Pessimistic', 'Target Value',
      'PERT Mean', 'PERT Std Dev', 'PERT Range\n(P \u2212 O)',
      'Baseline\nP(\u2264 Target)',
      'Benchmarked Opt\nP(\u2264 Target)', 'Unconstrained Opt\nP(\u2264 Target)',
      'Your Conditions\nP(\u2264 Target)', 'Best Strategy', 'Probability Gain',
      'P10', 'P25', 'P50\nMedian', 'P75', 'P80', 'P90',
      'P90 Headroom\n(P90 \u2212 Target)', 'P95',
      'Budget\nFlexibility', 'Schedule\nFlexibility', 'Scope\nCertainty',
      'Scope Reduction\nAllowance', 'Rework %', 'Risk\nTolerance', 'User\nConfidence',
      'KL Divergence', 'RCF Applied', 'RCF  n\n(# Projects)', 'RCF Mean\nOverrun',
      'Playbook Flags', 'Top Recommendation'
    ];
    var C = SW_COLOURS_.data;
    var bgPerCol = [
      C.context, C.context, C.context, C.context,
      C.inputs,  C.inputs,  C.inputs,  C.inputs,
      C.pert,    C.pert,    C.pert,
      C.probability, C.probability, C.probability,
      C.probability, C.probability, C.probability,
      C.percentiles, C.percentiles, C.percentiles, C.percentiles,
      C.percentiles, C.percentiles, C.percentiles, C.percentiles,
      C.conditions, C.conditions, C.conditions, C.conditions,
      C.conditions, C.conditions, C.conditions,
      C.diagnostics, C.diagnostics, C.diagnostics, C.diagnostics,
      C.recommend, C.recommend
    ];

    // Row 1: title
    swApplyTitle_(sheet, totalCols,
      'ProjectCare \u2014 Batch Report   |   ' +
      payloads.length + ' task' + (payloads.length !== 1 ? 's' : '') +
      '   |   ' + dateStr);

    // Row 2: section bands
    sheet.getRange(2, 1, 1, totalCols).setBackground('#E2E8F0');
    for (var s = 0; s < sections.length; s++) {
      var sec = sections[s];
      var sc = SW_COLOURS_.section[sec.key] || SW_COLOURS_.section.context;
      sheet.getRange(2, sec.col, 1, sec.span)
           .merge()
           .setValue(sec.label)
           .setBackground(sc.bg).setFontColor(sc.fg)
           .setFontWeight('bold').setFontSize(8)
           .setHorizontalAlignment('left').setVerticalAlignment('middle');
    }
    sheet.setRowHeight(2, 18);

    // Row 3: column headers
    swApplyHeaderRow_(sheet, 3, headers, null, bgPerCol);

    // Rows 4+: one data row per task
    for (var t = 0; t < payloads.length; t++) {
      var p    = payloads[t];
      var pct  = p.basePct || swPercentiles_(p.baseCdf || []);
      var best = swBestStrategy_(p.benchmarkedProb, p.unconstrainedProb, p.yourConditionsProb);
      var p90  = pct.p90;
      var p90h = (p90 != null && p.target != null) ? (p90 - p.target) : null;
      var gain = (best.prob != null && p.baselineProb != null) ? (best.prob - p.baselineProb) : null;
      var pertMean  = ((p.O || 0) + 4*(p.M || 0) + (p.P || 0)) / 6;
      var pertStd   = ((p.P || 0) - (p.O || 0)) / 6;
      var pertRange = (p.P || 0) - (p.O || 0);

      var bestSliders = null;
      if      (best.name === 'Unconstrained Optimization') bestSliders = p.unconstrainedSliders;
      else if (best.name === 'Benchmarked Optimization')   bestSliders = p.benchmarkedSliders;
      else if (best.name === 'Your Conditions')             bestSliders = p.yourConditionsSliders;

      var bestKL       = p.unconstrainedKL || p.benchmarkedKL || null;
      var playbookText = Array.isArray(p.playbookFlags) ? p.playbookFlags.join('; ') : (p.playbookFlags || '');

      var values = [
        swDate_(now.toISOString()), 'Batch', taskCount || payloads.length, p.taskName || '',
        swFmt_(p.O, 2), swFmt_(p.M, 2), swFmt_(p.P, 2),
        p.target != null ? swFmt_(p.target, 2) : '',
        swFmt_(pertMean, 2), swFmt_(pertStd, 2), swFmt_(pertRange, 2),
        p.baselineProb      != null ? swPct_(p.baselineProb)      : '',
        p.benchmarkedProb   != null ? swPct_(p.benchmarkedProb)   : '',
        p.unconstrainedProb != null ? swPct_(p.unconstrainedProb) : '',
        p.yourConditionsProb!= null ? swPct_(p.yourConditionsProb): '',
        best.name || '', gain != null ? swPct_(gain) : '',
        pct.p10 != null ? swFmt_(pct.p10, 2) : '',
        pct.p25 != null ? swFmt_(pct.p25, 2) : '',
        pct.p50 != null ? swFmt_(pct.p50, 2) : '',
        pct.p75 != null ? swFmt_(pct.p75, 2) : '',
        pct.p80 != null ? swFmt_(pct.p80, 2) : '',
        p90     != null ? swFmt_(p90, 2)      : '',
        p90h    != null ? swFmt_(p90h, 2)     : '',
        pct.p95 != null ? swFmt_(pct.p95, 2)  : '',
        swSlider_(bestSliders, 'budgetFlexibility'),
        swSlider_(bestSliders, 'scheduleFlexibility'),
        swSlider_(bestSliders, 'scopeCertainty'),
        swSlider_(bestSliders, 'scopeReductionAllowance'),
        swSlider_(bestSliders, 'reworkPercentage'),
        swSlider_(bestSliders, 'riskTolerance'),
        swSlider_(bestSliders, 'userConfidence'),
        bestKL          != null ? swFmt_(bestKL, 4)          : '',
        p.rcfApplied    ? 'Yes' : 'No',
        p.rcfN          != null ? p.rcfN                     : '',
        p.rcfMeanOverrun!= null ? swPct_(p.rcfMeanOverrun)   : '',
        playbookText, p.topRecommendation || ''
      ];

      var rowBg = (t % 2 === 0) ? bgPerCol : bgPerCol.map(function() { return SW_COLOURS_.altRow; });
      swApplyDataRow_(sheet, 4 + t, values, rowBg);
    }

    swFinishSheet_(sheet, totalCols, [
      120, 65, 55, 160,
      68, 68, 68, 80,
      80, 80, 75,
      80, 90, 95, 90, 145, 80,
      68, 68, 68, 68, 68, 68, 95, 68,
      72, 72, 72, 90, 68, 68, 68,
      85, 75, 75, 85,
      220, 280
    ]);

    ss.setActiveSheet(sheet);
    return { ok: true, tabName: tabName };
  } catch(e) {
    console.log('pcWriteBatchReportTab_ error: ' + e.message);
    return { ok: false, error: e.message };
  }
}

// ── Public entry point ───────────────────────────────────────────────────────
function pcWriteReportTab(payload, mode) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var tz = ss.getSpreadsheetTimeZone();
    var now = new Date();
    var dateStr = Utilities.formatDate(now, tz, "MMM d, yyyy");
    var label = mode === 'snapshot' ? 'Snapshot' : 'Full Report';
    var tabName = 'PMC ' + label + ' \u2014 ' + dateStr;

    // If a tab with this exact name already exists, append a counter
    var existing = ss.getSheetByName(tabName);
    if (existing) {
      var counter = 2;
      while (ss.getSheetByName(tabName + ' (' + counter + ')')) counter++;
      tabName = tabName + ' (' + counter + ')';
    }

    var sheet = ss.insertSheet(tabName);

    if (mode === 'snapshot') {
      _pmcWriteSnapshot_(sheet, payload, now);
    } else {
      _pmcWriteFullReport_(sheet, payload, now);
    }

    // Activate the new sheet so user sees it immediately
    ss.setActiveSheet(sheet);

    return { ok: true, tabName: tabName };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}
