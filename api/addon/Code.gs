/************************************************************
 * Code.gs — ProjectCare Free (PERT + PLOT)
 * - Normalization function is now simply normalizePoints (no V3 suffix)
 * - Only checks isNumber(x) — no y condition
 * - All code in one file — no external files, no duplicates
 ************************************************************/

/************************************************************
 * 1. CONFIG
 ************************************************************/
var CFG = {
  SRC_SHEET_NAME: 'data',
  SRC_SHEET_INDEX: 0,
  OUT_SHEET_NAME: 'Estimate Calculations',
  LOG_SHEET_NAME: 'PERT_Logs',
  DATA_ROW_HEIGHT_PX: 50,
  COL_WIDTH_PX: 110,
  STATUS_COL_WIDTH_PX: 300,
  JSON_COL_WIDTH_PX: 220,
  MAX_POINTS: 200,
  API_RETRIES: 3,
  P2_MAX_RETRIES: 2,
  P2_STRONG_RETRY: true,
  LOOP_SAFETY_MS: 6*60*1000 - 15000,
  CONFIDENCE: 0.95,
  ALLOW_P3_WITHOUT_SLIDERS: true,
  DUPLICATE_BASELINE_ON_NO_IMPROVE: true
};

/************************************************************
 * 2. HEADERS
 ************************************************************/
// Column index constants — update here if schema changes
var COL = {
  // A. Inputs (1-4) — unchanged
  NAME:1, BEST:2, MOST:3, WORST:4,
  // B. PERT + baseline summary (5-8) — unchanged
  PERT:5, CI_LO:6, CI_HI:7, BASE_PROB:8,
  // C. Optimization outputs (9-18) — unchanged
  S_BUDGET:9, S_SCHED:10, S_SCOPE:11, S_SCOPE_RED:12,
  S_REWORK:13, S_RISK:14, S_CONF:15,
  OPT_PROB:16, SENS:17, KLD:18,
  // D. NEW — Classical PERT analytics (19-21)
  PERT_STD:19, TRI_MEAN:20, RISK_RANGE:21,
  // E. NEW — Monte Carlo analytics (22-29)
  MC_MEAN:22, MC_STD:23, MC_CV:24,
  MC_P50:25, MC_P80:26, MC_P90:27,
  MC_SKEW:28, PROB_LIFT:29,
  // F. Raw JSON blobs (30-33) — shifted from old 19-22
  BASE_PDF:30, BASE_CDF:31, OPT_PDF:32, OPT_CDF:33,
  STATUS:34
};

var HEADERS = [
  // A. Inputs (cols 1-4)
  'Name', 'Best Case', 'Most Likely', 'Worst Case',

  // B. PERT + Baseline Summary (cols 5-8)  — positions UNCHANGED
  'PERT Mean',
  'MC 95% CI Lower', 'MC 95% CI Upper',
  'P(finish ≤ PERT Mean)  [Baseline %]',

  // C. Optimization Outputs (cols 9-18)  — positions UNCHANGED
  'Optimal Budget Flexibility',
  'Optimal Schedule Flexibility',
  'Optimal Scope Certainty',
  'Optimal Scope Reduction Allowance',
  'Optimal Rework Percentage',
  'Optimal Risk Tolerance',
  'Optimal User Confidence',
  'P(finish ≤ PERT Mean) After Optimization',
  'MC Sensitivity Change',
  'KL Divergence (Triangle → MC)',

  // D. Classical PERT Analytics (cols 19-21)  ← NEW
  'PERT Std Dev [(P-O)/6]',
  'Triangle Mean [(O+M+P)/3]',
  'Risk Range (P-O)',

  // E. Monte Carlo Analytics (cols 22-29)  ← NEW
  'MC Mean (Expected Value)',
  'MC Std Dev',
  'Coefficient of Variation (MC Std/Mean)',
  'MC P50 — Median',
  'MC P80 — 80th Percentile',
  'MC P90 — 90th Percentile',
  'MC Skewness',
  'Probability Lift (opt − baseline, pp)',

  // F. Raw JSON blobs — technical (cols 30-34)
  'Baseline MC PDF (JSON)',
  'Baseline MC CDF (JSON)',
  'Optimized MC PDF (JSON)',
  'Optimized MC CDF (JSON)',
  'Status'
];

var HEADER_NOTES = [
  // A
  'Task name or identifier',
  'Optimistic / best-case estimate (O)',
  'Most-likely estimate (M)',
  'Pessimistic / worst-case estimate (P)',

  // B
  'PERT mean = (O + 4M + P) / 6  — classical 3-point weighted average',
  'Lower bound of Monte Carlo smoothed 95% confidence interval',
  'Upper bound of Monte Carlo smoothed 95% confidence interval',
  'Probability the outcome falls at or below the PERT mean (baseline, no optimization)',

  // C
  'Optimal budget flexibility (%) from slider optimization',
  'Optimal schedule flexibility (%) from slider optimization',
  'Optimal scope certainty (%) from slider optimization',
  'Optimal scope reduction allowance (%) from slider optimization',
  'Optimal rework percentage (%) from slider optimization',
  'Optimal risk tolerance (%) from slider optimization',
  'Optimal user confidence (%) from slider optimization',
  'Probability at PERT mean after applying optimal slider settings',
  'Sensitivity change metric from Monte Carlo optimization',
  'KL divergence from Triangle to MC-smoothed baseline — measures model divergence (0 = identical)',

  // D — new
  'PERT standard deviation = (P-O)/6 — measures spread under the 3-sigma assumption',
  'Triangle distribution mean = (O+M+P)/3 — simpler than PERT; ignores Most-Likely weighting',
  'Risk Range = P - O — total span of estimates; larger = more uncertainty',

  // E — new
  'Monte Carlo expected value (mean) from 10k simulation runs — may differ from PERT mean',
  'Monte Carlo standard deviation — actual spread from simulation',
  'Coefficient of Variation = MC Std Dev / MC Mean — unitless risk measure; >0.5 = high variability',
  '50th percentile (median) from MC CDF — half the simulations finished at or below this value',
  '80th percentile from MC CDF — industry-standard schedule buffer point (P80 planning)',
  '90th percentile from MC CDF — conservative buffer; 90% of simulations finish at or below this',
  'MC distribution skewness — positive = right-skewed (long tail of overruns); negative = left-skewed',
  'Probability Lift = optimized probability − baseline probability (percentage points) — how much optimization helped',

  // F
  'Baseline MC-smoothed PDF points (JSON array) — used by Plot UI',
  'Baseline MC-smoothed CDF points (JSON array) — used by Plot UI',
  'Optimized MC-smoothed PDF points (JSON array) — used by Plot UI',
  'Optimized MC-smoothed CDF points (JSON array) — used by Plot UI',
  'Processing status with timestamps'
];

/************************************************************
 * 3. UTILITIES
 ************************************************************/
function nowStamp() {
  const d = new Date();
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}
function tsMsg(msg) { return `${msg} @ ${nowStamp()}`; }
function safeAlert_(msg) { try { SpreadsheetApp.getUi().alert(msg); } catch(_){} }
function toast_(title, msg, sec) {
  try { SpreadsheetApp.getActiveSpreadsheet().toast(msg || '', title || '', sec || 5); } catch(_) {}
}

function isNumber(x) {
  return x != null && !isNaN(x) && Number.isFinite(x);
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;

  let n;
  if (typeof v === 'number') {
    n = v;
  } else if (typeof v === 'string') {
    n = parseFloat(v.trim().replace(/[^0-9.-]/g, ''));
  } else {
    n = Number(v);
  }

  if (Number.isFinite(n) && !isNaN(n)) return n;

  if (typeof v === 'object' && v !== null && 'value' in v) {
    return num(v.value);
  }

  return null;
}

function toFixed6(v) { return isNumber(v) ? Number(v).toFixed(6) : ''; }
function clipArray(arr, n) { return Array.isArray(arr) ? arr.slice(0, Math.max(0, n|0)) : []; }

/**
 * Inverse CDF: find x where CDF(x) ≈ prob via linear interpolation.
 * Used to compute P50/P80/P90 percentiles from MC CDF point arrays.
 */
function interpXfromCDF_(cdfPts, prob) {
  if (!Array.isArray(cdfPts) || cdfPts.length < 2) return null;
  for (let i = 1; i < cdfPts.length; i++) {
    const y0 = Number(cdfPts[i-1].y), y1 = Number(cdfPts[i].y);
    const x0 = Number(cdfPts[i-1].x), x1 = Number(cdfPts[i].x);
    if (y1 >= prob && y0 <= prob) {
      const dy = y1 - y0;
      const t = dy > 1e-12 ? (prob - y0) / dy : 0;
      return x0 + t * (x1 - x0);
    }
  }
  // prob above last point — return last x
  return Number(cdfPts[cdfPts.length - 1].x);
}

/**
 * Compute MC mean, std dev, and skewness from PDF point array
 * using trapezoidal numerical integration.
 * Returns { mean, std, skew } — all null if insufficient data.
 */
function computeMCStats_(pdfPts) {
  const nil = { mean: null, std: null, skew: null };
  if (!Array.isArray(pdfPts) || pdfPts.length < 2) return nil;
  let mean = 0;
  for (let i = 1; i < pdfPts.length; i++) {
    const dx   = Number(pdfPts[i].x)   - Number(pdfPts[i-1].x);
    const avgY = (Number(pdfPts[i].y)  + Number(pdfPts[i-1].y)) / 2;
    const avgX = (Number(pdfPts[i].x)  + Number(pdfPts[i-1].x)) / 2;
    mean += avgX * avgY * dx;
  }
  let variance = 0, m3 = 0;
  for (let i = 1; i < pdfPts.length; i++) {
    const dx   = Number(pdfPts[i].x)   - Number(pdfPts[i-1].x);
    const avgY = (Number(pdfPts[i].y)  + Number(pdfPts[i-1].y)) / 2;
    const avgX = (Number(pdfPts[i].x)  + Number(pdfPts[i-1].x)) / 2;
    const d = avgX - mean;
    variance += d * d * avgY * dx;
    m3       += d * d * d * avgY * dx;
  }
  const std  = Math.sqrt(Math.max(0, variance));
  const skew = std > 1e-12 ? m3 / (std * std * std) : 0;
  return { mean, std, skew };
}
function scale01To100_(v) {
  const n = num(v);
  if (!isNumber(n)) return null;
  return (n >= 0 && n <= 1) ? (n * 100) : (isNumber(n) ? n : null);
}

// SINGLE NORMALIZATION FUNCTION - renamed to plain normalizePoints
function normalizePoints(arr) {
  console.log('normalizePoints LOADED - starting normalization');
  if (!Array.isArray(arr)) {
    console.log('normalizePoints: received non-array');
    return [];
  }
  const out = [];
  let kept = 0;
  let dropped = 0;
  for (let i = 0; i < arr.length; i++) {
    const p = arr[i];
    if (!p || typeof p !== 'object') {
      dropped++;
      continue;
    }

    const x = num(p.x);
    let yNumeric = num(p.y);
    let y = yNumeric;
    if (!isNumber(yNumeric)) {
      y = p.y != null ? String(p.y) : "0";
      console.log('normalizePoints fallback: y = "' + y + '" (type: ' + typeof y + ') at point #' + (i+1));
    }

    if (isNumber(x)) {
      out.push({ x, y });
      kept++;
      console.log('normalizePoints KEPT #' + (i+1) + ': x=' + x + ', y=' + y + ' (y type: ' + typeof y + ')');
    } else {
      dropped++;
      console.log('normalizePoints DROPPED (bad x) #' + (i+1) + ': ' + JSON.stringify(p));
    }
  }
  console.log('normalizePoints COMPLETE: processed ' + arr.length + ' → kept ' + kept + ', dropped ' + dropped);
  return out;
}

function setHeaderNotes_(sheet) {
  const rng = sheet.getRange(1, 1, 1, HEADERS.length);
  rng.setValues([HEADERS]).setFontWeight('bold');
  for (let c = 1; c <= HEADERS.length; c++) {
    sheet.getRange(1, c).setNote(HEADER_NOTES[c-1] || '');
  }
}

/* -------- Slider key aliasing + normalization helpers ---------- */

var SLIDER_KEYS = [
  'budgetFlexibility','scheduleFlexibility','scopeCertainty',
  'scopeReductionAllowance','reworkPercentage','riskTolerance','userConfidence'
];

function aliasSliderKey_(name) {
  if (!name) return null;
  const n = String(name).toLowerCase().replace(/\s+/g, '').replace(/[^a-z]/g, '');
  const map = {
    'budgetflexibility': 'budgetFlexibility',
    'scheduleflexibility': 'scheduleFlexibility',
    'scopecertainty': 'scopeCertainty',
    'scopereductionallowance': 'scopeReductionAllowance',
    'reworkpercentage': 'reworkPercentage',
    'risktolerance': 'riskTolerance',
    'userconfidence': 'userConfidence'
  };
  return map[n] || null;
}

function normalizeSlidersToPct_(src) {
  if (!src || typeof src !== 'object') return null;
  const out = {};
  let foundAny = false;
  SLIDER_KEYS.forEach(key => {
    let val = src[key];
    let parsedVal = num(val);
    if (!isNumber(parsedVal) && typeof val === 'string') {
      parsedVal = parseFloat(val.trim());
    }
    if (isNumber(parsedVal)) {
      out[key] = Math.max(0, Math.min(100, parsedVal * 100));
      foundAny = true;
    } else if (typeof val === 'string' && val.trim() !== '') {
      const clean = val.replace(/[% ]/g, '');
      const floatVal = parseFloat(clean);
      if (!isNaN(floatVal)) {
        out[key] = Math.max(0, Math.min(100, floatVal));
        foundAny = true;
      }
    }
  });
  return foundAny ? out : null;
}

function isDefaultSliderVector_(slidersPct) {
  if (!slidersPct || typeof slidersPct !== 'object') return false;
  const def = { budgetFlexibility:25, scheduleFlexibility:12.5, scopeCertainty:90, scopeReductionAllowance:25, reworkPercentage:0, riskTolerance:70, userConfidence:77.5 };
  return SLIDER_KEYS.every(k => isNumber(slidersPct[k]) && Math.abs(slidersPct[k] - def[k]) < 1e-6);
}

/* -------- PERT helper -------- */
function computePertMean_(O, M, P) {
  const o = num(O), m = num(M), p = num(P);
  if ([o,m,p].every(isNumber)) return (o + 4*m + p) / 6;
  return null;
}

/**
 * Validate a three-point estimate task.
 * Returns null if valid, or an array of human-readable error strings if invalid.
 *
 * Rules:
 *  - All three values must be valid numbers
 *  - All values must be ≥ 0
 *  - Best Case (O) ≤ Most Likely (M) ≤ Worst Case (P)
 *  - Best Case < Worst Case (non-zero range required for distribution)
 */
function validateTask_(task) {
  const O = num(task.optimistic);
  const M = num(task.mostLikely);
  const P = num(task.pessimistic);
  const errors = [];

  if (!isNumber(O) || !isNumber(M) || !isNumber(P)) {
    errors.push('One or more estimate values are not valid numbers (got O=' +
      task.optimistic + ', M=' + task.mostLikely + ', P=' + task.pessimistic + ').' +
      ' All three columns (Best Case, Most Likely, Worst Case) must contain numeric values.');
    return errors; // no point checking ordering if values aren't numbers
  }
  if (O < 0 || M < 0 || P < 0) {
    errors.push('All values must be ≥ 0 (got O=' + O + ', M=' + M + ', P=' + P +
      '). Negative estimates are not supported — use 0 as the minimum.');
  }
  if (O > M) {
    errors.push('Best Case (' + O + ') must be ≤ Most Likely (' + M +
      '). Fix: ensure Best Case ≤ Most Likely ≤ Worst Case.');
  }
  if (M > P) {
    errors.push('Most Likely (' + M + ') must be ≤ Worst Case (' + P +
      '). Fix: ensure Best Case ≤ Most Likely ≤ Worst Case.');
  }
  if (O >= P) {
    errors.push('Best Case (' + O + ') must be strictly less than Worst Case (' + P +
      '). A non-zero range is required to build a distribution — set Worst Case > Best Case.');
  }
  return errors.length > 0 ? errors : null;
}

/************************************************************
 * 4. MENUS
 ************************************************************/
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  const pert = ui.createMenu('PERT')
    .addItem('All Rows',      'pertRunAllRows')
    .addItem('Selected Rows', 'pertRunSelectedRows')
    .addItem('Checked Rows',  'pertRunCheckedRows')
    .addSeparator()
    .addItem('Re-run Last Sheet', 'pertRerunLastSheet')
    .addSeparator()
    .addItem('Export Run Log', 'writeLogsToSheet');
  const settings = ui.createMenu('Settings')
    .addItem('Select Data Tab',            'pcSelectDataTab')
    .addSeparator()
    .addItem('Add "Run?" Checkbox Column', 'pcAddCheckboxColumn')
    .addItem('Clear Validation Highlights', 'pcClearHighlights');
  ui.createMenu('ProjectCare')
    .addSubMenu(pert)
    .addItem('PLOT', 'openPlotUi')
    .addSubMenu(settings)
    .addToUi();
}
function openPlotUi() {
  const html = HtmlService.createHtmlOutputFromFile('addon/Plot')
    .setTitle('PLOT')
    .setWidth(1200)
    .setHeight(900)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);

  // Inject server-side data — inlined so there is no dependency on any new
  // function being callable via google.script.run.
  var _tabs = [];
  try {
    var _ss = SpreadsheetApp.getActiveSpreadsheet();
    if (_ss) {
      _tabs = _ss.getSheets().map(function(sh) {
        return { name: sh.getName(), id: sh.getSheetId() };
      });
    }
  } catch(_e) {}
  var _settings = {};
  try {
    var _props = PropertiesService.getDocumentProperties();
    var _raw   = _props.getProperty('pmc_settings_v1');
    if (_raw) _settings = JSON.parse(_raw);
  } catch(_e2) {}
  var inject = '<script>window._PMC_SERVER_DATA=' +
    JSON.stringify({ sheetTabs: _tabs, pmcSettings: _settings, _v: Date.now() }) +
    ';</script>';
  html.setContent(inject + html.getContent());

  SpreadsheetApp.getUi().showModelessDialog(html, 'ProjectCare');
}

/************************************************************
 * 6. API CALLER (LOCAL EXECUTION)
 ************************************************************/
function callEstimatorAPI_(payloadObj, label) {
  try {
    const tasks = Array.isArray(payloadObj) ? payloadObj : (payloadObj.tasks || [payloadObj]);
    const result = projectcareAPI(tasks);
    console.log(`Local core call (${label}): Success`);
    return { ok: true, code: 200, body: result };
  } catch (e) {
    console.log(`Local core call (${label}): Error - ${e.message}`);
    return { ok: false, code: 0, body: null, error: e.message || 'Local execution failed' };
  }
}

/************************************************************
 * 7. PAYLOAD BUILDERS
 ************************************************************/
function normalizeSlidersOut_(sliders) {
  if (!sliders || typeof sliders !== 'object') return undefined;
  const out = {};
  SLIDER_KEYS.forEach(k => {
    const n = num(sliders[k]);
    if (isNumber(n)) out[k] = Math.max(0, Math.min(100, n));
  });
  return Object.keys(out).length > 0 ? out : undefined;
}

function buildTaskPayload_(task, options) {
  const normalizedSliders = normalizeSlidersOut_(options.sliderValues);

  const optimistic = Number(num(task.optimistic));
  const mostLikely = Number(num(task.mostLikely));
  const pessimistic = Number(num(task.pessimistic));

  console.log('Payload types BEFORE core: optimistic=' + typeof optimistic + ' (' + optimistic + '), mostLikely=' + typeof mostLikely + ' (' + mostLikely + '), pessimistic=' + typeof pessimistic + ' (' + pessimistic + ')');

  const t = {
    task: task.task || task.name || '',
    name: task.task || task.name || '',
    optimistic: optimistic,
    mostLikely: mostLikely,
    pessimistic: pessimistic,
    targetValue: num(options.targetValue),
    confidenceLevel: isNumber(options.confidenceLevel) ? options.confidenceLevel : CFG.CONFIDENCE,
    wantPoints: !!options.wantPoints,
    includeOptimizedPoints: !!options.includeOptimizedPoints,
    includeMetrics: true,
    maxPoints: isNumber(options.maxPoints) ? options.maxPoints : CFG.MAX_POINTS,
    optimize: !!options.optimize,
    optimizeFor: options.optimize ? (options.optimizeFor || 'target') : undefined,
    sliderValues: normalizedSliders,
    profile: options.profile || 'full',
    suppressOtherDistros: false,
    adaptive: !!options.adaptive,
    probeLevel: options.probeLevel != null ? Number(options.probeLevel) : undefined
  };
  if (options.extraFlags && typeof options.extraFlags === 'object') {
    Object.assign(t, options.extraFlags);
  }
  Object.keys(t).forEach(k => { if (t[k] === undefined || t[k] === null) delete t[k]; });

  return [ t ];
}

function payloadBaseline_(task, targetPert) {
  return buildTaskPayload_(task, {
    targetValue: targetPert,
    wantPoints: true,
    includeOptimizedPoints: false,
    extraFlags: {
      returnProbabilityAtPert: true,
      distributionType: 'monte-carlo-smoothed'
    }
  });
}

function payloadOptimize_(task, pert, strong) {
  return buildTaskPayload_(task, {
    targetValue: pert,
    wantPoints: true,
    optimize: true,
    optimizeFor: 'target',
    includeOptimizedPoints: true,
    adaptive: false,
    extraFlags: Object.assign({
      returnArrays: true,
      materialize: true,
      returnOptimalSliderSettings: true,
      includeSliderSettings: true,
      requireOptimizedPoints: true,
      forceOptimizedPoints: true,
      distributionType: 'monte-carlo-smoothed'
    }, strong ? {
      searchDepth: 3,
      algorithm: 'de',
      optimizationBudget: 250
    } : {})
  });
}

function payloadMaterialize_(task, pert, sliders, extraFlags) {
  return buildTaskPayload_(task, {
    targetValue: pert,
    wantPoints: true,
    includeOptimizedPoints: true,
    sliderValues: sliders,
    adaptive: false,
    extraFlags: Object.assign({
      requireOptimizedPoints: true,
      forceOptimizedPoints: true,
      allowBaselineCopy: true,
      neutralOnNoOp: true,
      returnArrays: true,
      materialize: true,
      distributionType: 'monte-carlo-smoothed'
    }, extraFlags || {})
  });
}

/************************************************************
 * 8. RESPONSE NORMALIZERS
 ************************************************************/
function firstResult_(body) {
  if (!body) return null;
  if (Array.isArray(body) && body.length > 0) return body[0];
  if (Array.isArray(body.results) && body.results.length > 0) return body.results[0];
  if (Array.isArray(body.tasks) && body.tasks.length > 0) return body.tasks[0];
  if (body.result) return body.result;
  if (body.data) return body.data;
  return body;
}

function getAnyPath_(obj, paths) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (let p of paths) {
    try {
      let val = obj;
      for (const k of p.split('.')) {
        if (val == null || !(k in val)) {
          val = undefined;
          break;
        }
        val = val[k];
      }
      if (val !== undefined && val !== null) return val;
    } catch(_){}
  }
  return undefined;
}

function parseBaseline_(resObj) {
  if (!resObj) {
    console.log('parseBaseline_: No resObj at all');
    return { pert: null, ciL: null, ciU: null, baseProb: null, kld: null, basePDF: [], baseCDF: [] };
  }

  console.log('parseBaseline_: resObj top keys = ' + Object.keys(resObj).join(', '));
  if (resObj.baseline) {
    console.log('parseBaseline_: baseline exists — keys = ' + Object.keys(resObj.baseline).join(', '));
  }

  let pertRaw = getAnyPath_(resObj, ['baseline.pert']);
  let pertValue = null;

  if (pertRaw) {
    console.log('PERT raw type = ' + typeof pertRaw + ', raw content = ' + JSON.stringify(pertRaw));
    if (typeof pertRaw === 'object' && pertRaw !== null && 'value' in pertRaw) {
      pertValue = pertRaw.value;
      console.log('PERT .value found, type = ' + typeof pertValue + ', raw = ' + pertValue);
    }
  }

  let pert = Number(pertValue);
  if (!isNumber(pert)) pert = num(pertValue);
  if (!isNumber(pert)) pert = num(getAnyPath_(resObj, ['baseline.pert.value']));

  let ciL = num(
    getAnyPath_(resObj, [
      'baseline.metrics.monteCarloSmoothed.ci.lower',
      'baseline.monteCarloSmoothed.ci.lower',
      'baseline.monteCarloSmoothed.ciLower',
      'baseline.ci.lower',
      'baseline.confidenceInterval.lower',
      'baseline.monteCarloSmoothed.confidenceInterval.lower',
      'baseline.monteCarloSmoothed.95ci.lower',
      'baseline.ciLower',
      'baseline.confidenceInterval.lowerBound'
    ])
  );

  let ciU = num(
    getAnyPath_(resObj, [
      'baseline.metrics.monteCarloSmoothed.ci.upper',
      'baseline.monteCarloSmoothed.ci.upper',
      'baseline.monteCarloSmoothed.ciUpper',
      'baseline.ci.upper',
      'baseline.confidenceInterval.upper',
      'baseline.monteCarloSmoothed.confidenceInterval.upper',
      'baseline.monteCarloSmoothed.95ci.upper',
      'baseline.ciUpper',
      'baseline.confidenceInterval.upperBound'
    ])
  );

  let baseProb = num(
    getAnyPath_(resObj, [
      'baseline.probabilityAtTarget.value',
      'baseline.probabilityAtPert.value',
      'baseline.targetProbability.value.original',
      'baseline.probabilityAtTarget.value',
      'baseline.targetProbability.original',
      'baseline.probabilityAtPert'
    ])
  );

  let kld = num(
    getAnyPath_(resObj, [
      'baseline.monteCarloSmoothed.klDivergenceToTriangle',
      'baseline.klDivergenceToTriangle',
      'baseline.metrics.klDivergenceToTriangle',
      'baseline.kl',
      'baseline.kld',
      'baseline.metrics.kld'
    ])
  );

  let basePDF = normalizePoints(
    getAnyPath_(resObj, [
      'baseline.monteCarloSmoothed.pdfPoints',
      'baseline.pdfPoints',
      'allDistributions.value.monteCarloSmoothed.pdfPoints',
      'baseline.monteCarloSmoothedPoints.pdfPoints',
      'baseline.monteCarloSmoothed.pdf'
    ]) || []
  );

  let baseCDF = normalizePoints(
    getAnyPath_(resObj, [
      'baseline.monteCarloSmoothed.cdfPoints',
      'baseline.cdfPoints',
      'allDistributions.value.monteCarloSmoothed.cdfPoints',
      'baseline.monteCarloSmoothedPoints.cdfPoints',
      'baseline.monteCarloSmoothed.cdf'
    ]) || []
  );

  console.log('===== parseBaseline_ DEBUG =====');
  console.log('PERT extracted = ' + (isNumber(pert) ? pert : 'NULL — FAILED'));
  console.log('CI Lower = ' + (ciL || 'NULL'));
  console.log('CI Upper = ' + (ciU || 'NULL'));
  console.log('Baseline Prob = ' + (baseProb || 'NULL'));
  console.log('KL = ' + (kld || 'NULL'));
  console.log('PDF points length = ' + basePDF.length);
  console.log('CDF points length = ' + baseCDF.length);
  console.log('===== END DEBUG =====');

  return { pert, ciL, ciU, baseProb, kld, basePDF, baseCDF };
}

function parseOptimized_(resObj) {
  if (!resObj) {
    console.log('parseOptimized_: No resObj at all');
    return { sliders: null, optProb: null, sensChange: null, optPDF: [], optCDF: [] };
  }

  console.log('parseOptimized_: resObj top keys = ' + Object.keys(resObj).join(', '));
  if (resObj.optimize) {
    console.log('parseOptimized_: optimize exists — keys = ' + Object.keys(resObj.optimize).join(', '));
  }

  let slidersRaw = getAnyPath_(resObj, ['optimize.revertedSliders']) ||
    getAnyPath_(resObj, ['optimalSliderSettings']) ||
    getAnyPath_(resObj, ['optimalSliderSettings.value']) ||
    getAnyPath_(resObj, ['optimize.sliders']) ||
    getAnyPath_(resObj, ['optimize.winningSliders']);

  let sliders = {};
  if (slidersRaw) {
    if (slidersRaw.value && typeof slidersRaw.value === 'object') {
      slidersRaw = slidersRaw.value;
      console.log('parseOptimized_: unwrapped nested "value" in sliders');
    }
    console.log('parseOptimized_: raw sliders (after unwrap/reversion) = ' + JSON.stringify(slidersRaw));
    Object.keys(slidersRaw).forEach(k => {
      const val = slidersRaw[k];
      if (val !== undefined) {
        const parsed = num(val);
        if (isNumber(parsed)) {
          sliders[k] = parsed <= 1 ? (parsed * 100).toFixed(2) : parsed.toFixed(2);
        } else if (typeof val === 'string') {
          sliders[k] = val;
        }
      }
    });
    if (Object.keys(sliders).length === 0) {
      console.log('Slider copy fallback triggered - no keys matched');
      SLIDER_KEYS.forEach(k => {
        const val = slidersRaw[k];
        if (val !== undefined) {
          const parsed = num(val);
          if (isNumber(parsed)) {
            sliders[k] = parsed <= 1 ? (parsed * 100).toFixed(2) : parsed.toFixed(2);
          } else if (typeof val === 'string') {
            sliders[k] = val;
          }
        }
      });
    }
  }

  let optProb = num(
    getAnyPath_(resObj, ['optimize.finalProb']) ||
    getAnyPath_(resObj, ['optimize.probabilityAtTarget.value']) ||
    getAnyPath_(resObj, ['targetProbability.value.adjustedOptimized']) ||
    getAnyPath_(resObj, ['targetProbability.value.adjusted']) ||
    getAnyPath_(resObj, ['optimize.targetProbability']) ||
    getAnyPath_(resObj, ['optimize.metrics.finalProbability']) ||
    getAnyPath_(resObj, ['targetProbability.value']) ||
    getAnyPath_(resObj, ['decisionReports.1.finalProbability'])
  );

  let sensChange = num(getAnyPath_(resObj, ['optimize.metrics.sensitivityChange']));

  let optPDF = normalizePoints(
    getAnyPath_(resObj, ['optimizedReshapedPoints.pdfPoints']) ||
    getAnyPath_(resObj, ['optimize.reshapedPoints.pdfPoints']) ||
    getAnyPath_(resObj, ['optimize.monteCarloSmoothed.pdfPoints']) ||
    getAnyPath_(resObj, ['monteCarloSmoothedPoints.pdfPoints'])
  );

  let optCDF = normalizePoints(
    getAnyPath_(resObj, ['optimizedReshapedPoints.cdfPoints']) ||
    getAnyPath_(resObj, ['optimize.reshapedPoints.cdfPoints']) ||
    getAnyPath_(resObj, ['optimize.monteCarloSmoothed.cdfPoints']) ||
    getAnyPath_(resObj, ['monteCarloSmoothedPoints.cdfPoints'])
  );

  console.log('===== parseOptimized_ DEBUG =====');
  console.log('Opt Prob = ' + (optProb || 'NULL'));
  console.log('Sensitivity Change = ' + (sensChange || 'NULL'));
  console.log('Opt PDF length = ' + optPDF.length);
  console.log('Opt CDF length = ' + optCDF.length);
  console.log('Sliders = ' + JSON.stringify(sliders));
  console.log('===== END DEBUG =====');

  return { sliders, optProb, sensChange, optPDF, optCDF };
}

function normalizePlotResponseForUI_(resp) {
  try {
    const first = firstResult_(resp) || resp || {};

    if (!first.targetProbabilityOriginalPdf && !first.targetProbabilityOriginalCdf) {
      const basePdf = getAnyPath_(first, ['baseline.monteCarloSmoothed.pdfPoints','allDistributions.value.monteCarloSmoothed.pdfPoints']);
      const baseCdf = getAnyPath_(first, ['baseline.monteCarloSmoothed.cdfPoints','allDistributions.value.monteCarloSmoothed.cdfPoints']);
      if (basePdf || baseCdf) {
        first.targetProbabilityOriginalPdf = { value: normalizePoints(basePdf || []) };
        first.targetProbabilityOriginalCdf = { value: normalizePoints(baseCdf || []) };
      }
    }

    if (!first.targetProbabilityAdjustedPdf && !first.targetProbabilityAdjustedCdf) {
      const adjPdf = getAnyPath_(first, [
        'optimize.reshapedPoints.pdfPoints',
        'optimize.reshapedPoints.value.pdfPoints',
        'optimizedReshapedPoints.pdfPoints',
        'optimize.monteCarloSmoothed.pdfPoints',
        'optimize.pdfPoints'
      ]);
      const adjCdf = getAnyPath_(first, [
        'optimize.reshapedPoints.cdfPoints',
        'optimize.reshapedPoints.value.cdfPoints',
        'optimizedReshapedPoints.cdfPoints',
        'optimize.monteCarloSmoothed.cdfPoints',
        'optimize.cdfPoints'
      ]);
      if (adjPdf || adjCdf) {
        first.targetProbabilityAdjustedPdf = { value: normalizePoints(adjPdf || []) };
        first.targetProbabilityAdjustedCdf = { value: normalizePoints(adjCdf || []) };
      }
    }

    return first;
  } catch (e) {
    console.log(`normalizePlotResponseForUI error: ${e.message}`);
    return firstResult_(resp) || resp || {};
  }
}

/************************************************************
 * 9. PERT ENTRY POINTS
 ************************************************************/
// ── Column detection ─────────────────────────────────────────────────────────
// Detects Name/O/M/P columns from a header row. Returns 1-based column indices
// (-1 = not found). Accepts flexible header names (case-insensitive).
function detectColumns_(headers) {
  let nameCol = -1, optCol = -1, mostCol = -1, pessCol = -1, checkCol = -1;
  for (let c = 0; c < headers.length; c++) {
    const h = String(headers[c] || '').trim().toLowerCase().replace(/[-_ ]+/g, '');
    if (h.includes('name') || h.includes('task') || h.includes('title')) nameCol = c + 1;
    if (h.includes('bestcase') || h.includes('optimistic') || h === 'best' || h === 'o') optCol = c + 1;
    if (h.includes('mostlikely') || h.includes('most') || h.includes('likely') || h === 'm') mostCol = c + 1;
    if (h.includes('worstcase') || h.includes('pessimistic') || h === 'worst' || h === 'p') pessCol = c + 1;
    if (h === 'run?' || h === 'run' || h === '✓' || h === 'include' || h === 'check') checkCol = c + 1;
  }
  return { nameCol, optCol, mostCol, pessCol, checkCol };
}

// Returns true if the sheet has all four required columns detectable from row 1.
function looksLikeTaskData_(sheet) {
  try {
    if (!sheet || sheet.getLastColumn() < 3 || sheet.getLastRow() < 2) return false;
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const m = detectColumns_(headers);
    return m.nameCol > 0 && m.optCol > 0 && m.mostCol > 0 && m.pessCol > 0;
  } catch(_) { return false; }
}

// ── Pre-flight validation ─────────────────────────────────────────────────────
// Scans rows, highlights invalid cells in source sheet, returns categorised rows.
// Returns { valid: [{task,optimistic,mostLikely,pessimistic,row},...],
//           invalid: [{row, name, reason},...] }
function preflight_(sheet, colMap, startRow, endRow) {
  const numCols = Math.max(colMap.nameCol, colMap.optCol, colMap.mostCol, colMap.pessCol);
  const values  = sheet.getRange(startRow, 1, endRow - startRow + 1, numCols).getValues();

  const valid = [], invalid = [];
  const highlightRanges = [];  // cells to mark red

  for (let i = 0; i < values.length; i++) {
    const r      = values[i];
    const rowNum = startRow + i;
    const name   = String(r[colMap.nameCol - 1] != null ? r[colMap.nameCol - 1] : '').trim();

    if (!name) {
      // blank name — skip silently (common to have trailing empty rows)
      continue;
    }

    const rawO = r[colMap.optCol  - 1];
    const rawM = r[colMap.mostCol - 1];
    const rawP = r[colMap.pessCol - 1];
    const O    = (typeof rawO === 'number') ? rawO : num(rawO);
    const M    = (typeof rawM === 'number') ? rawM : num(rawM);
    const P    = (typeof rawP === 'number') ? rawP : num(rawP);

    const task = { task: name, optimistic: O, mostLikely: M, pessimistic: P, _row: rowNum };
    const errs = validateTask_(task);

    if (!errs) {
      valid.push(task);
    } else {
      // Collect the specific bad cells for highlighting
      if (!isNumber(O)) highlightRanges.push(sheet.getRange(rowNum, colMap.optCol));
      if (!isNumber(M)) highlightRanges.push(sheet.getRange(rowNum, colMap.mostCol));
      if (!isNumber(P)) highlightRanges.push(sheet.getRange(rowNum, colMap.pessCol));
      if (isNumber(O) && isNumber(M) && isNumber(P)) {
        // Order violations — highlight all three
        if (O > M || M > P || O >= P) {
          highlightRanges.push(sheet.getRange(rowNum, colMap.optCol));
          highlightRanges.push(sheet.getRange(rowNum, colMap.mostCol));
          highlightRanges.push(sheet.getRange(rowNum, colMap.pessCol));
        }
      }
      // Short reason for the dialog
      let reason = '';
      if (!isNumber(O) || !isNumber(M) || !isNumber(P)) {
        reason = 'non-numeric value';
      } else if (O > M || M > P) {
        reason = 'O \u2264 M \u2264 P order violated (' + O + ', ' + M + ', ' + P + ')';
      } else if (O >= P) {
        reason = 'Best Case must be < Worst Case (' + O + ' vs ' + P + ')';
      }
      invalid.push({ row: rowNum, name: name, reason: reason });
    }
  }

  // Apply highlight to invalid cells
  if (highlightRanges.length > 0) {
    highlightRanges.forEach(function(rng) {
      try { rng.setBackground('#FECACA'); } catch(_) {}
    });
  }

  return { valid: valid, invalid: invalid };
}

// Lets the user pin which tab contains their task data.
// Saves the choice to document properties; getSourceSheet_() reads it on every run.
function pcSelectDataTab() {
  const ss     = SpreadsheetApp.getActiveSpreadsheet();
  const ui     = SpreadsheetApp.getUi();
  const sheets = ss.getSheets();

  if (sheets.length === 0) { safeAlert_('No sheets found.'); return; }

  // Build numbered list; mark auto-detected task-data sheets with (*)
  const lines = sheets.map(function(s, i) {
    const mark = looksLikeTaskData_(s) ? ' (*)' : '';
    return (i + 1) + ')  ' + s.getName() + mark;
  });

  const current = PropertiesService.getDocumentProperties().getProperty('pmc_last_src_sheet') || '(not set)';
  const prompt  = 'Current: ' + current + '\n\n' + lines.join('\n') + '\n\n(*) = detected task-data columns\n\nEnter number:';

  const response = ui.prompt('Select Data Tab', prompt, ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;

  const idx = parseInt(response.getResponseText().trim(), 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= sheets.length) {
    safeAlert_('Invalid selection. Enter a number between 1 and ' + sheets.length + '.');
    return;
  }

  const selected = sheets[idx].getName();
  PropertiesService.getDocumentProperties().setProperty('pmc_last_src_sheet', selected);
  toast_('Settings', 'Data tab set to: "' + selected + '". All Rows will use this tab.', 5);
}

// Clears red validation highlights from the entire source sheet data area.
function pcClearHighlights() {
  const ss     = SpreadsheetApp.getActiveSpreadsheet();
  const active = ss.getActiveSheet();
  if (!active || active.getLastRow() < 2) { toast_('Settings', 'Nothing to clear.', 3); return; }
  try {
    active.getRange(2, 1, active.getLastRow() - 1, active.getLastColumn()).setBackground(null);
    toast_('Settings', 'Highlights cleared on: ' + active.getName(), 3);
  } catch(e) {
    safeAlert_('Could not clear highlights: ' + e.message);
  }
}

// Builds the pre-flight confirmation message and asks user to proceed or cancel.
// Returns true if user confirms (or no invalids), false if cancelled.
function preflightConfirm_(sheetName, valid, invalid) {
  if (invalid.length === 0) {
    toast_('PERT', 'Running on: ' + sheetName + ' \u2014 ' + valid.length + ' rows', 4);
    return true;
  }
  const lines = ['Running on: ' + sheetName,
    valid.length + ' valid, ' + invalid.length + ' invalid (will be skipped).',
    '',
    'Invalid rows:'];
  const show = invalid.slice(0, 10);  // cap at 10 lines in dialog
  show.forEach(function(inv) {
    lines.push('  \u2022 Row ' + inv.row + ': ' + inv.name + ' \u2014 ' + inv.reason);
  });
  if (invalid.length > 10) lines.push('  \u2026 and ' + (invalid.length - 10) + ' more (see highlights in sheet).');
  lines.push('');
  lines.push('Invalid cells are highlighted in red. Proceed with ' + valid.length + ' valid row(s)?');
  const ui       = SpreadsheetApp.getUi();
  const response = ui.alert('ProjectCare \u2014 Pre-flight Check', lines.join('\n'), ui.ButtonSet.OK_CANCEL);
  return response === ui.Button.OK;
}

// Saves the last-used source sheet name to document properties.
function saveLastSheet_(sheetName) {
  try {
    PropertiesService.getDocumentProperties().setProperty('pmc_last_src_sheet', sheetName);
  } catch(_) {}
}

// ── Source sheet resolution ───────────────────────────────────────────────────
// Priority: (1) active sheet if it looks like task data,
//           (2) last-used sheet (ScriptProperties),
//           (3) CFG.SRC_SHEET_NAME fallback,
//           (4) any sheet with detectable task columns.
function getSourceSheet_() {
  const ss     = SpreadsheetApp.getActiveSpreadsheet();
  const active = ss.getActiveSheet();

  // 1. Active sheet takes priority — most natural for multi-sheet workbooks
  if (active && looksLikeTaskData_(active)) return active;

  // 2. Last-used sheet remembered across sessions
  try {
    const last = PropertiesService.getDocumentProperties().getProperty('pmc_last_src_sheet');
    if (last) {
      const byLast = ss.getSheetByName(last);
      if (byLast && looksLikeTaskData_(byLast)) return byLast;
    }
  } catch(_) {}

  // 3. CFG name fallback (legacy)
  if (CFG.SRC_SHEET_NAME) {
    const byName = ss.getSheetByName(CFG.SRC_SHEET_NAME);
    if (byName && looksLikeTaskData_(byName)) return byName;
  }

  // 4. Any sheet that looks like task data
  const sheets = ss.getSheets();
  for (const sh of sheets) {
    if (looksLikeTaskData_(sh)) return sh;
  }

  return null;
}

function getAllTasks(params) {
  // Overloaded: pass {action:'listTabs'} to just get sheet tab list.
  // This lets the client avoid calling new undeployed functions.
  if (params && params.action === 'listTabs') {
    var tabs = [];
    try {
      var ss2 = SpreadsheetApp.getActiveSpreadsheet();
      if (ss2) tabs = ss2.getSheets().map(function(sh) {
        return { name: sh.getName(), id: sh.getSheetId() };
      });
    } catch(_e) {}
    return { action: 'listTabs', sheetTabs: tabs };
  }

  try {
    console.log('getAllTasks() started @ ' + new Date().toISOString());

    const sh = getSourceSheet_();
    if (!sh) {
      console.log('ERROR: No source sheet found');
      return [{ task:'(No source sheet found)', optimistic:null, mostLikely:null, pessimistic:null }];
    }
    console.log('Source sheet found: ' + sh.getName() + ' (ID: ' + sh.getSheetId() + ')');

    const lastRow = sh.getLastRow();
    console.log('Last row in sheet: ' + lastRow);
    if (lastRow < 2) {
      console.log('ERROR: Sheet empty (lastRow < 2)');
      return [{ task:'(Source sheet empty: add rows under headers)', optimistic:null, mostLikely:null, pessimistic:null }];
    }

    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    console.log('Raw headers: ' + headers.map(h => JSON.stringify(h)).join(' | '));

    let nameCol = -1, optCol = -1, mostCol = -1, pessCol = -1;
    for (let c = 0; c < headers.length; c++) {
      const h = String(headers[c] || '').trim().toLowerCase().replace(/[-_ ]+/g, '');
      console.log('Header ' + (c+1) + ': "' + h + '"');

      if (h.includes('name') || h.includes('task') || h.includes('title')) nameCol = c + 1;
      if (h.includes('bestcase') || h.includes('optimistic') || h.includes('best') ) optCol = c + 1;
      if (h.includes('mostlikely') || h.includes('most') || h.includes('likely')) mostCol = c + 1;
      if (h.includes('worstcase') || h.includes('pessimistic') || h.includes('worst')) pessCol = c + 1;
    }

    console.log('Detected columns (1-based): Name=' + nameCol + ', Best=' + optCol + ', Most=' + mostCol + ', Worst=' + pessCol);

    if (nameCol === -1 || optCol === -1 || mostCol === -1 || pessCol === -1) {
      console.log('ERROR: Missing required columns');
      return [{ task:'(Missing required headers - check sheet row 1)', optimistic:null, mostLikely:null, pessimistic:null }];
    }

    const values = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).getValues();
    console.log('Raw data from sheet (first 5 rows): ' + JSON.stringify(values.slice(0, 5)));

    const out = [];
    for (let i = 0; i < values.length; i++) {
      const r = values[i];
      const nameRaw = r[nameCol - 1];
      const name = (nameRaw != null && String(nameRaw).trim()) || '';

      if (!name) {
        console.log('Row ' + (i+2) + ': Skipped (empty name)');
        continue;
      }

      const rawO = r[optCol - 1];
      const rawM = r[mostCol - 1];
      const rawP = r[pessCol - 1];

      console.log('Row ' + (i+2) + ': Name="' + name + '", Raw Best=' + rawO + ' (type: ' + typeof rawO + '), Raw Most=' + rawM + ' (type: ' + typeof rawM + '), Raw Worst=' + rawP + ' (type: ' + typeof rawP + ')');

      let O = (typeof rawO === 'number') ? rawO : num(rawO);
      let M = (typeof rawM === 'number') ? rawM : num(rawM);
      let P = (typeof rawP === 'number') ? rawP : num(rawP);

      console.log('Row ' + (i+2) + ': Parsed O=' + O + ', M=' + M + ', P=' + P);

      if (isNumber(O) && isNumber(M) && isNumber(P)) {
        console.log('Row ' + (i+2) + ': VALID TASK ADDED');
        out.push({ task: name, optimistic: O, mostLikely: M, pessimistic: P });
      } else {
        console.log('Row ' + (i+2) + ': Skipped (invalid parsed numbers)');
      }
    }

    if (!out.length) {
      console.log('No valid tasks found after processing all rows');
      return [{ task:'(No valid tasks found - check sheet data)', optimistic:null, mostLikely:null, pessimistic:null }];
    }

    console.log('Found ' + out.length + ' valid tasks');

    // Return enriched object so client can also get sheet tab list without
    // needing a separately-deployed listSheetTabs() function.
    var sheetTabs = [];
    try {
      var allSheets = SpreadsheetApp.getActiveSpreadsheet().getSheets();
      sheetTabs = allSheets.map(function(sh) {
        return { name: sh.getName(), id: sh.getSheetId() };
      });
    } catch(_e) {}
    return { tasks: out, sheetTabs: sheetTabs };

  } catch (e) {
    console.log('ERROR in getAllTasks: ' + e.message + ' (stack: ' + e.stack + ')');
    return { tasks: [{ task:`(Error reading source: ${e.message})`, optimistic:null, mostLikely:null, pessimistic:null }], sheetTabs: [] };
  }
}

/************************************************************
 * 10. PLOT DATA
 ************************************************************/
function getTargetProbabilityData(params) {
  if (!params || !params.task) throw new Error('Missing params.task');

  const task = {
    task: params.task, name: params.task,
    optimistic: params.optimistic, mostLikely: params.mostLikely, pessimistic: params.pessimistic
  };

  const chosenTarget = params.targetValue;

  const extra = {
    returnArrays: true,
    materialize: true,
    returnOptimalSliderSettings: true,
    includeSliderSettings: true,
    requireOptimizedPoints: !!(params && (params.isOptimizeMode || params.optimize)),
    forceOptimizedPoints: !!(params && (params.isOptimizeMode || params.optimize)),
    includeAllDistributions: true,
    returnAllDistributions: true,
    returnDistributions: true,
    returnBaselineDistributions: true,
    includeTriangle: true,
    includeBetaPert: true,
    returnTriangle: true,
    returnBetaPert: true,
    returnMonteCarloSmoothed: true,
    distributions: ['triangle','betaPert','monteCarloSmoothed'],
    includeAdjusted: true,
    returnAdjusted: true,
    returnSliderAdjustedPoints: true,
    returnDecisionReports: true,
    distributionType: 'monte-carlo-smoothed'
  };

  const payload = buildTaskPayload_(task, {
    targetValue: chosenTarget,
    confidenceLevel: (typeof params.confidenceLevel === 'number') ? params.confidenceLevel : CFG.CONFIDENCE,
    wantPoints: true,
    includeOptimizedPoints: !!params.isOptimizeMode || !!params.optimize,
    optimize: !!params.isOptimizeMode || !!params.optimize,
    optimizeFor: (params.mode === 'mean' || params.mode === 'risk') ? params.mode : 'target',
    sliderValues: params.sliderValues || undefined,
    adaptive: !!params.adaptive,
    probeLevel: params.probeLevel != null ? Number(params.probeLevel) : undefined,
    extraFlags: extra
  });

  const r = callEstimatorAPI_(payload, 'plot_proxy');
  if (!r.ok) throw new Error(r.error || 'API error');

  return normalizePlotResponseForUI_(r.body);
}

/************************************************************
 * 11. RE-MATERIALIZE (Selection)
 ************************************************************/
function rematerializeSelection() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const out = ss.getSheets().find(function(sh) { return sh.getName().indexOf(CFG.OUT_SHEET_NAME) === 0; }) || null;
  if (!out) { safeAlert_('No output sheet found.'); return; }
  const sel = out.getActiveRange();
  if (!sel) { safeAlert_('Select rows in the output sheet first.'); return; }

  const startRow = Math.max(2, sel.getRow());
  const endRow = Math.min(out.getLastRow(), startRow + sel.getNumRows() - 1);

  let ok = 0, err = 0, skip = 0;
  for (let r = startRow; r <= endRow; r++) {
    const name = String(out.getRange(r, 1).getValue() || '').trim();
    const O = num(out.getRange(r, 2).getValue());
    const M = num(out.getRange(r, 3).getValue());
    const P = num(out.getRange(r, 4).getValue());
    const pert = num(out.getRange(r, 5).getValue());

    if (!name || !isNumber(pert) || !isNumber(O) || !isNumber(M) || !isNumber(P)) { 
      skip++; 
      continue; 
    }

    const sliders = {};
    for (let i = 0; i < SLIDER_KEYS.length; i++) {
      const v = num(out.getRange(r, 9 + i).getValue());
      if (isNumber(v)) sliders[SLIDER_KEYS[i]] = v;
    }

    const task = { task: name, optimistic: O, mostLikely: M, pessimistic: P };
    const res = doMaterialize_(task, pert, sliders, r, out);
    if (res && res.ok) ok++; else err++;
  }
  toast_('Re-materialize', `OK=${ok}, Skipped=${skip}, Error=${err}`, 6);
}

function doMaterialize_(task, pert, sliders, row, out) {
  const extraFlags = CFG.DUPLICATE_BASELINE_ON_NO_IMPROVE ? { duplicateBaselineOnNoImprove: true } : {};
  const matPayload = payloadMaterialize_(task, pert, sliders, extraFlags);
  const matRes = callEstimatorAPI_(matPayload, `materialize-${task.task}`);
  if (!matRes.ok) {
    console.log(`Materialize call failed: ${matRes.error}`);
    return { ok: false, error: matRes.error };
  }
  const body = firstResult_(matRes.body);
  if (!body) {
    console.log('Materialize: Empty response body');
    return { ok: false, error: 'Empty response body' };
  }
  const parsedBase = parseBaseline_(body);
  const parsedOpt = parseOptimized_(body);

  if (!isNumber(parsedBase.pert)) {
    console.log('No PERT in materialize response');
    return { ok: false, error: 'No PERT in materialize response' };
  }

  console.log(`Starting writes for row ${row}`);
  out.getRange(row, 5).setValue(toFixed6(parsedBase.pert));
  SpreadsheetApp.flush();
  if (isNumber(parsedBase.ciL)) {
    out.getRange(row, 6).setValue(toFixed6(parsedBase.ciL));
    SpreadsheetApp.flush();
  }
  if (isNumber(parsedBase.ciU)) {
    out.getRange(row, 7).setValue(toFixed6(parsedBase.ciU));
    SpreadsheetApp.flush();
  }
  if (isNumber(parsedBase.baseProb)) {
    out.getRange(row, 8).setValue((parsedBase.baseProb * 100).toFixed(2));
    SpreadsheetApp.flush();
  }

  let col = 9;
  if (parsedOpt.sliders && typeof parsedOpt.sliders === 'object' && Object.keys(parsedOpt.sliders).length > 0) {
    console.log('Writing sliders: ' + JSON.stringify(parsedOpt.sliders));
    SLIDER_KEYS.forEach(k => {
      const rawV = parsedOpt.sliders[k];
      let v = num(rawV);
      if (!isNumber(v) && typeof rawV === 'string') {
        v = parseFloat(rawV.trim());
      }
      let displayV = isNumber(v) ? v.toFixed(2) : (rawV != null ? rawV : '—');
      if (isNumber(v) && v >= 0 && v <= 1) {
        displayV = (v * 100).toFixed(2);
      }
      out.getRange(row, col).setValue(displayV);
      console.log(`Slider ${k} → col ${col} (${String.fromCharCode(64 + col)}): raw=${rawV} → written=${displayV}`);
      SpreadsheetApp.flush();
      col++;
    });
  } else {
    console.log('No valid sliders object in parsedOpt - writing defaults/empty');
    SLIDER_KEYS.forEach(() => {
      out.getRange(row, col).setValue('—');
      SpreadsheetApp.flush();
      col++;
    });
  }

  let optPct = '';
  if (isNumber(parsedOpt.optProb)) {
    optPct = (parsedOpt.optProb * 100).toFixed(2);
  }
  out.getRange(row, 16).setValue(optPct);
  SpreadsheetApp.flush();
  console.log(`Optimized % written to col 16: ${optPct || '(empty)'}`);

  let sens = '—';
  if (isNumber(parsedOpt.sensChange)) {
    sens = parsedOpt.sensChange.toFixed(4);
  } else if (isNumber(parsedOpt.optProb) && isNumber(parsedBase.baseProb)) {
    sens = (parsedOpt.optProb - parsedBase.baseProb).toFixed(4);
  }
  out.getRange(row, 17).setValue(sens);
  SpreadsheetApp.flush();
  console.log(`Sensitivity Change written to col 17: ${sens}`);

  const kl = isNumber(parsedBase.kld) ? parsedBase.kld.toFixed(4) : '—';
  out.getRange(row, 18).setValue(kl);
  SpreadsheetApp.flush();

  const clip = CFG.MAX_POINTS;
  const pointsList = [parsedBase.basePDF, parsedBase.baseCDF, parsedOpt.optPDF, parsedOpt.optCDF];
  pointsList.forEach((pts, idx) => {
    const jsonCol = COL.BASE_PDF + idx;
    console.log(`Writing points to col ${jsonCol} (type=${typeof pts}, length=${pts?.length || 'undefined'})`);
    const clipped = clipArray(pts || [], clip);
    const jsonStr = JSON.stringify(clipped);
    console.log(`  JSON length before write: ${jsonStr.length} chars`);
    out.getRange(row, jsonCol).setValue(jsonStr);
    SpreadsheetApp.flush();
    console.log(`Points written to col ${jsonCol}: length=${clipped.length}`);
  });

  shadeConfidenceColumns_(out);
  console.log(`Materialize complete for row ${row}`);
  return { ok: true };
}

/************************************************************
 * 12. PERT RUNNERS
 ************************************************************/
function ensureHeadersAndWidths_(sheet) {
  const lastCol = sheet.getMaxColumns();
  if (lastCol < HEADERS.length) {
    sheet.insertColumnsAfter(lastCol, HEADERS.length - lastCol);
  }
  setHeaderNotes_(sheet);
  sheet.getRange(1, 1, 1, HEADERS.length)
    .setBackground('#4285f4')
    .setFontColor('white')
    .setHorizontalAlignment('center');

  for (let c = 1; c <= HEADERS.length; c++) {
    // 1-4: input cols (narrow), 5-18: existing analytics, 19-29: new analytics, 30+: JSON blobs
    const w = c <= 4 ? 120 : c <= 18 ? 150 : c <= 29 ? 140 : 250;
    sheet.setColumnWidth(c, w);
  }
}

function pertRunAllRows() {
  try {
    const src = getSourceSheet_();
    if (!src) {
      safeAlert_('No task data sheet found.\n\nNavigate to your data tab (with Name, Best Case, Most Likely, Worst Case columns) and try again.');
      return;
    }
    const sheetName = src.getName();
    const lastRow   = src.getLastRow();
    if (lastRow < 2) { safeAlert_('Sheet "' + sheetName + '" has no data rows.'); return; }

    const headers = src.getRange(1, 1, 1, src.getLastColumn()).getValues()[0];
    const colMap  = detectColumns_(headers);
    if (colMap.nameCol < 0 || colMap.optCol < 0 || colMap.mostCol < 0 || colMap.pessCol < 0) {
      safeAlert_('Sheet "' + sheetName + '" is missing required columns.\nExpected: Name (or Task), Best Case (or Optimistic), Most Likely, Worst Case (or Pessimistic).');
      return;
    }

    const pf = preflight_(src, colMap, 2, lastRow);
    if (!preflightConfirm_(sheetName, pf.valid, pf.invalid)) return;
    if (!pf.valid.length) { safeAlert_('No valid rows to process.'); return; }

    saveLastSheet_(sheetName);
    runTasks_(pf.valid, 'All Rows', pf.invalid);
  } catch (e) {
    safeAlert_('PERT All Rows failed: ' + e.message);
  }
}

function pertRunSelectedRows() {
  try {
    const ss     = SpreadsheetApp.getActiveSpreadsheet();
    const src    = ss.getActiveSheet();   // always the active sheet — user navigated here
    if (!src) { safeAlert_('No active sheet.'); return; }

    if (!looksLikeTaskData_(src)) {
      safeAlert_('This sheet doesn\'t appear to have task data.\n\nNavigate to your data tab (with Name, Best Case, Most Likely, Worst Case columns) and try again.');
      return;
    }

    const headers = src.getRange(1, 1, 1, src.getLastColumn()).getValues()[0];
    const colMap  = detectColumns_(headers);

    const sel = src.getActiveRange();
    if (!sel || sel.getRow() < 2) {
      safeAlert_('Select one or more data rows (below the header) and try again.'); return;
    }

    const startRow = Math.max(2, sel.getRow());
    const endRow   = Math.min(src.getLastRow(), sel.getLastRow());
    if (startRow > endRow) { safeAlert_('Selection is outside the data area.'); return; }

    const pf = preflight_(src, colMap, startRow, endRow);
    if (!preflightConfirm_(src.getName(), pf.valid, pf.invalid)) return;
    if (!pf.valid.length) { safeAlert_('No valid rows in selection.'); return; }

    saveLastSheet_(src.getName());
    runTasks_(pf.valid, 'Selected Rows', pf.invalid);
  } catch (e) {
    safeAlert_('PERT Selected Rows failed: ' + e.message);
  }
}

// Processes only rows where the "Run?" checkbox column is checked.
function pertRunCheckedRows() {
  try {
    const ss  = SpreadsheetApp.getActiveSpreadsheet();
    const src = ss.getActiveSheet();
    if (!src) { safeAlert_('No active sheet.'); return; }

    if (!looksLikeTaskData_(src)) {
      safeAlert_('This sheet doesn\'t appear to have task data.\n\nNavigate to your data tab and try again.');
      return;
    }

    const headers = src.getRange(1, 1, 1, src.getLastColumn()).getValues()[0];
    const colMap  = detectColumns_(headers);

    if (colMap.checkCol < 0) {
      safeAlert_('No "Run?" checkbox column found.\n\nUse PMC → Settings → Add "Run?" Checkbox Column to add one, then check the rows you want to process.');
      return;
    }

    const lastRow = src.getLastRow();
    if (lastRow < 2) { safeAlert_('Sheet has no data rows.'); return; }

    const numCols   = Math.max(colMap.nameCol, colMap.optCol, colMap.mostCol, colMap.pessCol, colMap.checkCol);
    const allValues = src.getRange(2, 1, lastRow - 1, numCols).getValues();

    // Collect row indices where checkbox is ticked
    const checkedRows = [];
    for (let i = 0; i < allValues.length; i++) {
      if (allValues[i][colMap.checkCol - 1] === true) checkedRows.push(i + 2);
    }

    if (!checkedRows.length) {
      safeAlert_('No rows are checked.\n\nTick the "Run?" checkbox on the rows you want to process.'); return;
    }

    // Pre-flight only the checked rows
    const pf = { valid: [], invalid: [] };
    for (const rowNum of checkedRows) {
      const singlePf = preflight_(src, colMap, rowNum, rowNum);
      pf.valid.push(...singlePf.valid);
      pf.invalid.push(...singlePf.invalid);
    }

    if (!preflightConfirm_(src.getName(), pf.valid, pf.invalid)) return;
    if (!pf.valid.length) { safeAlert_('No valid checked rows to process.'); return; }

    saveLastSheet_(src.getName());
    runTasks_(pf.valid, 'Checked Rows', pf.invalid);
  } catch (e) {
    safeAlert_('PERT Checked Rows failed: ' + e.message);
  }
}

// Re-runs PERT All Rows on the last-used data sheet, regardless of active sheet.
function pertRerunLastSheet() {
  try {
    const props = PropertiesService.getDocumentProperties();
    const last  = props.getProperty('pmc_last_src_sheet');
    if (!last) {
      safeAlert_('No previous run found.\n\nRun "PERT → All Rows" first, then use Re-run Last Sheet to refresh.'); return;
    }
    const ss  = SpreadsheetApp.getActiveSpreadsheet();
    const src = ss.getSheetByName(last);
    if (!src) {
      safeAlert_('Last-used sheet "' + last + '" no longer exists.\n\nNavigate to your data tab and use "All Rows" instead.');
      return;
    }

    const lastRow = src.getLastRow();
    if (lastRow < 2) { safeAlert_('Sheet "' + last + '" has no data rows.'); return; }

    const headers = src.getRange(1, 1, 1, src.getLastColumn()).getValues()[0];
    const colMap  = detectColumns_(headers);
    if (colMap.nameCol < 0 || colMap.optCol < 0 || colMap.mostCol < 0 || colMap.pessCol < 0) {
      safeAlert_('Sheet "' + last + '" is missing required columns.'); return;
    }

    const pf = preflight_(src, colMap, 2, lastRow);
    if (!preflightConfirm_(last, pf.valid, pf.invalid)) return;
    if (!pf.valid.length) { safeAlert_('No valid rows to process.'); return; }

    runTasks_(pf.valid, 'Re-run: ' + last, pf.invalid);
  } catch (e) {
    safeAlert_('PERT Re-run Last Sheet failed: ' + e.message);
  }
}

// Adds a "Run?" checkbox column to the active sheet, after the last data column.
function pcAddCheckboxColumn() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const src = ss.getActiveSheet();
  if (!src) { safeAlert_('No active sheet.'); return; }

  const headers = src.getLastColumn() > 0
    ? src.getRange(1, 1, 1, src.getLastColumn()).getValues()[0]
    : [];
  const colMap = detectColumns_(headers);

  if (colMap.checkCol > 0) {
    safeAlert_('"Run?" column already exists at column ' + colMap.checkCol + ' in this sheet.'); return;
  }

  const lastCol    = src.getLastColumn() + 1;
  const lastDataRow = Math.max(src.getLastRow(), 2);

  // Header
  src.getRange(1, lastCol).setValue('Run?')
     .setFontWeight('bold')
     .setBackground('#D1FAE5')
     .setNote('Check the rows you want to include when using PERT \u2192 Checked Rows.');

  // Checkboxes for all data rows
  if (lastDataRow > 1) {
    src.getRange(2, lastCol, lastDataRow - 1, 1)
       .insertCheckboxes()
       .setBackground('#F0FDF4');
  }

  src.setColumnWidth(lastCol, 55);
  toast_('Settings', '"Run?" column added at column ' + lastCol + ' in "' + src.getName() + '"', 5);
}

function runTasks_(tasks, mode, skippedRows) {
  const ss      = SpreadsheetApp.getActiveSpreadsheet();
  const tz      = ss.getSpreadsheetTimeZone();
  const dateStr = Utilities.formatDate(new Date(), tz, 'MMM d, yyyy');
  const tabName = CFG.OUT_SHEET_NAME + ' \u2014 ' + dateStr;

  // Re-use today's tab if it already exists (second run same day); otherwise create fresh.
  let out = ss.getSheetByName(tabName);
  if (!out) {
    // Remove any previous Estimate Calculations tab (any date) to keep the sheet list clean.
    ss.getSheets().forEach(function(sh) {
      if (sh.getName().indexOf(CFG.OUT_SHEET_NAME) === 0) {
        try { ss.deleteSheet(sh); } catch(_) {}
      }
    });
    out = ss.insertSheet(tabName);
  }
  if (out.getLastRow() > 1) {
    // Clear only up to the sheet's actual column count — avoids "out of bounds" error
    // when upgrading from an older schema with fewer columns.
    // ensureHeadersAndWidths_ (below) will then insert any missing columns.
    const clearCols = Math.max(1, Math.min(out.getLastColumn(), out.getMaxColumns()));
    out.getRange(2, 1, out.getLastRow() - 1, clearCols).clearContent();
  }
  ensureHeadersAndWidths_(out);

  const logSheet = ensureLogSheet_();
  const startRow = 2;

  let ok = 0, err = 0, partial = 0;
  const reportPayloads = [];
  const startTime = Date.now();
  toast_(mode, `Found ${tasks.length} task(s) — starting...`, 4);
  logSheet.appendRow([tsMsg(`${mode}: Starting ${tasks.length} tasks`)]);

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const row = startRow + i;
    const statusCol = HEADERS.length;
    try {
      out.getRange(row, 1, 1, 4).setValues([[task.task, task.optimistic || '', task.mostLikely || '', task.pessimistic || '']]);
      SpreadsheetApp.flush();

      // Validate inputs before making any API calls
      const validationErrors = validateTask_(task);
      if (validationErrors) {
        const errMsg = 'INVALID INPUT: ' + validationErrors.join(' | ');
        out.getRange(row, statusCol).setValue(tsMsg(errMsg));
        SpreadsheetApp.flush();
        logSheet.appendRow([tsMsg(`Task "${task.task}": ${errMsg}`)]);
        err++;
        continue;
      }

      out.getRange(row, statusCol).setValue('Running...');
      SpreadsheetApp.flush();

      const res = doSingleTask_(task, row, out, logSheet);
      if (res && res.payload) {
        res.payload.taskCount = tasks.length;
        reportPayloads.push(res.payload);
      }
      if (res && res.ok) {
        out.getRange(row, statusCol).setValue(tsMsg('OK'));
        SpreadsheetApp.flush();
        ok++;
      } else if (res && res.partial) {
        out.getRange(row, statusCol).setValue(tsMsg('PARTIAL'));
        SpreadsheetApp.flush();
        partial++;
      } else {
        out.getRange(row, statusCol).setValue(tsMsg('ERROR: ' + (res ? res.error : 'Unknown')));
        SpreadsheetApp.flush();
        err++;
      }
    } catch (e) {
      out.getRange(row, statusCol).setValue(tsMsg('EXCEPTION: ' + e.message));
      SpreadsheetApp.flush();
      err++;
      logSheet.appendRow([tsMsg(`Task "${task.task}": ${e.message}`)]);
    }
    SpreadsheetApp.flush();
    if (Date.now() - startTime > CFG.LOOP_SAFETY_MS) {
      logSheet.appendRow([tsMsg('Safety timeout hit')]);
      break;
    }
  }

  shadeConfidenceColumns_(out);

  // ── Append skipped-rows log to output sheet ───────────────────────────────
  if (skippedRows && skippedRows.length > 0) {
    const skipStartRow = out.getLastRow() + 2;
    out.getRange(skipStartRow, 1).setValue('SKIPPED ROWS (' + skippedRows.length + ')')
       .setFontWeight('bold').setBackground('#FEE2E2').setFontColor('#991B1B');
    out.getRange(skipStartRow, 2).setValue('Row').setFontWeight('bold').setBackground('#FEE2E2');
    out.getRange(skipStartRow, 3).setValue('Reason').setFontWeight('bold').setBackground('#FEE2E2');
    skippedRows.forEach(function(inv, idx) {
      const r = skipStartRow + 1 + idx;
      out.getRange(r, 1).setValue(inv.name).setBackground('#FFF1F2');
      out.getRange(r, 2).setValue(inv.row).setBackground('#FFF1F2');
      out.getRange(r, 3).setValue(inv.reason).setBackground('#FFF1F2');
    });
    SpreadsheetApp.flush();
    logSheet.appendRow([tsMsg('Skipped ' + skippedRows.length + ' invalid rows')]);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const skipNote = (skippedRows && skippedRows.length) ? ', ' + skippedRows.length + ' skipped' : '';
  const msg = `Done (${tasks.length} tasks): ${ok} OK, ${partial} partial, ${err} errors${skipNote} in ${elapsed}s`;
  toast_(mode, msg, 10);
  logSheet.appendRow([tsMsg(msg)]);

  // Write Full Report + Snapshot tabs — user lands on Snapshot (concise summary)
  if (reportPayloads.length > 0) {
    const batchDate = new Date();
    try {
      pcWriteBatchReportTab_(reportPayloads, tasks.length, batchDate);
    } catch(e) {
      logSheet.appendRow([tsMsg('Batch full report write failed: ' + e.message)]);
    }
    try {
      pcWriteBatchSnapshotTab_(reportPayloads, tasks.length, batchDate);
    } catch(e) {
      logSheet.appendRow([tsMsg('Batch snapshot write failed: ' + e.message)]);
    }
  }
}

function extractTopRec_(body) {
  if (!body) return '';
  try {
    var reports = body.decisionReports;
    if (!Array.isArray(reports)) return '';
    for (var i = 0; i < reports.length; i++) {
      var recs = reports[i].recommendations;
      if (Array.isArray(recs) && recs.length > 0) {
        var r = recs[0];
        return typeof r === 'string' ? r : (r.text || r.recommendation || r.action || '');
      }
    }
  } catch(_) {}
  return '';
}

function extractPlaybookFlags_(body) {
  if (!body) return [];
  try {
    var reports = body.decisionReports;
    if (!Array.isArray(reports)) return [];
    var flags = [];
    for (var i = 0; i < reports.length; i++) {
      var ci = reports[i].counterIntuition;
      if (Array.isArray(ci)) {
        ci.forEach(function(item) {
          var label = typeof item === 'string' ? item : (item.flag || item.label || item.message || '');
          if (label) flags.push(label);
        });
      }
    }
    return flags;
  } catch(_) {}
  return [];
}

function doSingleTask_(task, row, out, logSheet) {
  let hasBaseline = false;
  let pertForOpt = null;
  let baseParsed = null;

  try {
    const baselinePayload = payloadBaseline_(task, null);
    const baseRes = callEstimatorAPI_(baselinePayload, `baseline-${task.task}`);
    if (baseRes.ok) {
      const body = firstResult_(baseRes.body);
      console.log('Baseline response body keys: ' + Object.keys(body || {}).join(', '));

      baseParsed = parseBaseline_(body);
      if (isNumber(baseParsed.pert)) {
        pertForOpt = baseParsed.pert;

        out.getRange(row, 5).setValue(toFixed6(baseParsed.pert));
        SpreadsheetApp.flush();
        if (isNumber(baseParsed.ciL)) {
          out.getRange(row, 6).setValue(toFixed6(baseParsed.ciL));
          SpreadsheetApp.flush();
        }
        if (isNumber(baseParsed.ciU)) {
          out.getRange(row, 7).setValue(toFixed6(baseParsed.ciU));
          SpreadsheetApp.flush();
        }
        if (isNumber(baseParsed.baseProb)) {
          out.getRange(row, 8).setValue((baseParsed.baseProb * 100).toFixed(2));
          SpreadsheetApp.flush();
        }
        if (isNumber(baseParsed.kld)) {
          out.getRange(row, 18).setValue(toFixed6(baseParsed.kld));
          SpreadsheetApp.flush();
        }

        // D. Classical PERT analytics (cols 19-21) — computable from inputs alone
        const pertStd_   = (task.pessimistic - task.optimistic) / 6;
        const triMean_   = (task.optimistic + task.mostLikely + task.pessimistic) / 3;
        const riskRange_ = task.pessimistic - task.optimistic;
        if (isNumber(pertStd_))   { out.getRange(row, COL.PERT_STD).setValue(pertStd_.toFixed(4));     SpreadsheetApp.flush(); }
        if (isNumber(triMean_))   { out.getRange(row, COL.TRI_MEAN).setValue(triMean_.toFixed(4));     SpreadsheetApp.flush(); }
        if (isNumber(riskRange_)) { out.getRange(row, COL.RISK_RANGE).setValue(riskRange_.toFixed(4)); SpreadsheetApp.flush(); }

        // E. Monte Carlo analytics (cols 22-28) — derived from PDF/CDF point arrays
        const mcStats_ = computeMCStats_(baseParsed.basePDF);
        if (isNumber(mcStats_.mean)) { out.getRange(row, COL.MC_MEAN).setValue(mcStats_.mean.toFixed(4)); SpreadsheetApp.flush(); }
        if (isNumber(mcStats_.std))  { out.getRange(row, COL.MC_STD).setValue(mcStats_.std.toFixed(4));  SpreadsheetApp.flush(); }
        if (isNumber(mcStats_.mean) && Math.abs(mcStats_.mean) > 1e-12 && isNumber(mcStats_.std)) {
          out.getRange(row, COL.MC_CV).setValue((mcStats_.std / Math.abs(mcStats_.mean)).toFixed(4));
          SpreadsheetApp.flush();
        }
        if (isNumber(mcStats_.skew)) { out.getRange(row, COL.MC_SKEW).setValue(mcStats_.skew.toFixed(4)); SpreadsheetApp.flush(); }
        const p50_ = interpXfromCDF_(baseParsed.baseCDF, 0.50);
        const p80_ = interpXfromCDF_(baseParsed.baseCDF, 0.80);
        const p90_ = interpXfromCDF_(baseParsed.baseCDF, 0.90);
        if (isNumber(p50_)) { out.getRange(row, COL.MC_P50).setValue(p50_.toFixed(4)); SpreadsheetApp.flush(); }
        if (isNumber(p80_)) { out.getRange(row, COL.MC_P80).setValue(p80_.toFixed(4)); SpreadsheetApp.flush(); }
        if (isNumber(p90_)) { out.getRange(row, COL.MC_P90).setValue(p90_.toFixed(4)); SpreadsheetApp.flush(); }

        const clip = CFG.MAX_POINTS;
        [baseParsed.basePDF, baseParsed.baseCDF].forEach((pts, idx) => {
          const jsonCol = COL.BASE_PDF + idx;
          console.log(`Writing baseline points to col ${jsonCol} (length=${pts?.length || '0'})`);
          const jsonStr = JSON.stringify(clipArray(pts || [], clip));
          out.getRange(row, jsonCol).setValue(jsonStr);
          SpreadsheetApp.flush();
          console.log(`Baseline points written to col ${jsonCol}: length=${pts?.length || '0'}`);
        });

        hasBaseline = true;
        console.log(`Baseline written row ${row}: PERT=${baseParsed.pert}, Prob=${baseParsed.baseProb}`);
      } else {
        logSheet.appendRow([tsMsg(`Task "${task.task}": No PERT from baseline`)]);
      }
    } else {
      logSheet.appendRow([tsMsg(`Task "${task.task}": Baseline call failed - ${baseRes.error}`)]);
    }
  } catch (e) {
    logSheet.appendRow([tsMsg(`Task "${task.task}": Baseline exception - ${e.message}`)]);
  }

  let hasOpt = false;
  let reportPayload = null;
  if (isNumber(pertForOpt)) {
    try {
      const strong = CFG.P2_STRONG_RETRY;
      const optPayload = payloadOptimize_(task, pertForOpt, strong);
      const optRes = callEstimatorAPI_(optPayload, `opt-${task.task}`);
      if (optRes.ok) {
        const body = firstResult_(optRes.body);
        console.log('Optimize response body keys: ' + Object.keys(body || {}).join(', '));

        const optParsed = parseOptimized_(body);

        let col = 9;

        if (optParsed.sliders && typeof optParsed.sliders === 'object') {
          console.log('Writing sliders: ' + JSON.stringify(optParsed.sliders));
          SLIDER_KEYS.forEach(k => {
            const rawV = optParsed.sliders[k];
            let v = num(rawV);
            if (!isNumber(v) && typeof rawV === 'string') {
              v = parseFloat(rawV.trim());
            }
            let displayV = isNumber(v) ? v.toFixed(2) : (rawV != null ? rawV : '—');
            if (isNumber(v) && v >= 0 && v <= 1) {
              displayV = (v * 100).toFixed(2);
            }
            out.getRange(row, col).setValue(displayV);
            console.log(`Slider ${k} → col ${col} (${String.fromCharCode(64 + col)}): raw=${rawV} → written=${displayV}`);
            SpreadsheetApp.flush();
            col++;
          });

          // Warn if every slider came back as exactly 0 — may indicate API returned defaults
          // rather than a meaningful optimization result. This is flagged, not treated as an error,
          // because some flat distributions can legitimately yield zero adjustments.
          const sliderVals = SLIDER_KEYS.map(k => num(optParsed.sliders[k]));
          const allZero = sliderVals.every(v => isNumber(v) && v === 0);
          if (allZero) {
            console.log(`⚠ Task "${task.task}": all optimal slider values are 0 — API may have returned defaults. Check API logs for details.`);
            logSheet.appendRow([tsMsg(`⚠ Task "${task.task}": all optimal sliders are 0 — optimizer returned no adjustments. Probability still changed (baseline→opt), so baseline distribution is being used as-is.`)]);
          }

          hasOpt = true;
        } else {
          console.log('No valid sliders object in parsedOpt - writing defaults/empty');
          SLIDER_KEYS.forEach(() => {
            out.getRange(row, col).setValue('—');
            SpreadsheetApp.flush();
            col++;
          });
        }

        let optPct = '';
        if (isNumber(optParsed.optProb)) {
          optPct = (optParsed.optProb * 100).toFixed(2);
        }
        out.getRange(row, 16).setValue(optPct);
        SpreadsheetApp.flush();
        console.log(`Optimized % written to col 16: ${optPct || '(empty)'}`);

        let sens = '—';
        if (isNumber(optParsed.sensChange)) {
          sens = optParsed.sensChange.toFixed(4);
        } else if (isNumber(optParsed.optProb) && isNumber(baseParsed.baseProb)) {
          sens = (optParsed.optProb - baseParsed.baseProb).toFixed(4);
        }
        out.getRange(row, 17).setValue(sens);
        SpreadsheetApp.flush();
        console.log(`Sensitivity Change written to col 17: ${sens}`);

        const kl = isNumber(baseParsed.kld) ? baseParsed.kld.toFixed(4) : '—';
        out.getRange(row, 18).setValue(kl);
        SpreadsheetApp.flush();

        // Probability Lift (col 29) — optimization gain in percentage points
        if (isNumber(optParsed.optProb) && isNumber(baseParsed.baseProb)) {
          const lift_ = (optParsed.optProb - baseParsed.baseProb) * 100;
          out.getRange(row, COL.PROB_LIFT).setValue(lift_.toFixed(4));
          SpreadsheetApp.flush();
        }

        const clip = CFG.MAX_POINTS;
        const pointsList = [baseParsed.basePDF, baseParsed.baseCDF, optParsed.optPDF, optParsed.optCDF];
        pointsList.forEach((pts, idx) => {
          const jsonCol = COL.BASE_PDF + idx;
          console.log(`Writing points to col ${jsonCol} (type=${typeof pts}, length=${pts?.length || 'undefined'})`);
          const clipped = clipArray(pts || [], clip);
          const jsonStr = JSON.stringify(clipped);
          console.log(`  JSON length before write: ${jsonStr.length} chars`);
          out.getRange(row, jsonCol).setValue(jsonStr);
          SpreadsheetApp.flush();
          console.log(`Points written to col ${jsonCol}: length=${clipped.length}`);
        });

        if (optParsed.status && optParsed.status !== 'error') {
          out.getRange(row, HEADERS.length).setValue(optParsed.status);
          SpreadsheetApp.flush();
        }

        if (isNumber(optParsed.optProb) || optParsed.optPDF.length > 0 || optParsed.optCDF.length > 0 || optParsed.sliders) {
          hasOpt = true;
        }

        // Build payload for batch report (sliders in raw 0-1 from adapter, not UI-scaled)
        reportPayload = {
          taskName:           task.task,
          O: task.optimistic, M: task.mostLikely, P: task.pessimistic,
          target:             pertForOpt,
          baselineProb:       isNumber(baseParsed.baseProb) ? baseParsed.baseProb : null,
          baseCdf:            baseParsed.baseCDF || [],
          unconstrainedProb:  isNumber(optParsed.optProb) ? optParsed.optProb : null,
          unconstrainedSliders: (body && body.optimize && typeof body.optimize.sliders === 'object')
                                  ? body.optimize.sliders : null,
          unconstrainedKL:    isNumber(baseParsed.kld) ? baseParsed.kld : null,
          topRecommendation:  extractTopRec_(body),
          playbookFlags:      extractPlaybookFlags_(body),
          rcfApplied:         false
        };

        console.log(`Optimize processing complete for row ${row}: Prob=${optPct || 'N/A'}, Sliders written=${optParsed.sliders ? 'YES' : 'NO'}`);
      } else {
        logSheet.appendRow([tsMsg(`Task "${task.task}": Opt call failed - ${optRes.error}`)]);
      }
    } catch (e) {
      console.log(`Opt phase exception: ${e.message}`);
      logSheet.appendRow([tsMsg(`Task "${task.task}": Opt exception - ${e.message}`)]);
    }
  } else {
    logSheet.appendRow([tsMsg(`Task "${task.task}": Skipping opt — no valid PERT from baseline`)]);
  }

  if (hasBaseline && hasOpt) {
    return { ok: true, payload: reportPayload };
  } else if (hasBaseline || hasOpt) {
    return { partial: true, payload: reportPayload };
  } else {
    return { ok: false, error: 'Both baseline and opt failed' };
  }
}

function ensureLogSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let log = ss.getSheetByName(CFG.LOG_SHEET_NAME);
  if (!log) {
    log = ss.insertSheet(CFG.LOG_SHEET_NAME);
    log.getRange(1, 1).setValue('Timestamped Log').setFontWeight('bold');
  }
  return log;
}

function writeLogsToSheet() {
  const logSheet = ensureLogSheet_();
  toast_('Export Log', 'Log sheet already active—view "PERT_Logs"', 5);
}

/************************************************************
 * 13. FORMATTING HELPERS
 ************************************************************/
function shadeConfidenceColumns_(sheet) {
  try {
    // Col 5 = PERT Mean, 8 = Baseline Prob, 16 = Opt Prob,
    // 25 = MC P50, 26 = MC P80, 27 = MC P90, 29 = Probability Lift
    const COLS = [5, 8, 16, COL.MC_P50, COL.MC_P80, COL.MC_P90, COL.PROB_LIFT];
    const COLOR = '#d9ead3';
    const headerRow = 1;

    COLS.forEach(col => {
      const lastRow = sheet.getLastRow();
      if (lastRow <= headerRow) return;

      const rng = sheet.getRange(headerRow + 1, col, lastRow - headerRow, 1);
      const vals = rng.getDisplayValues().map(r => (r[0] || '').toString().trim());
      let lastNonEmpty = 0;
      for (let i = vals.length - 1; i >= 0; i--) {
        if (vals[i]) { lastNonEmpty = i + (headerRow + 1); break; }
      }
      if (lastNonEmpty > headerRow) {
        sheet.getRange(headerRow + 1, col, lastNonEmpty - headerRow, 1).setBackground(COLOR);
      }
    });
  } catch (_) {}
}

function testCoreCall() {
  const testTask = {
    task: "Test Project",
    optimistic: 10,
    mostLikely: 20,
    pessimistic: 30
  };
  const payload = [{
    task: testTask.task,
    name: testTask.task,
    optimistic: testTask.optimistic,
    mostLikely: testTask.mostLikely,
    pessimistic: testTask.pessimistic,
    targetValue: 20,
    confidenceLevel: 0.95,
    wantPoints: true,
    includeOptimizedPoints: false
  }];
  
  try {
    const result = projectcareAPI(payload);
    console.log('TEST CORE CALL RESULT: ' + JSON.stringify(result, null, 2));
  } catch (e) {
    console.log('TEST CORE CALL ERROR: ' + e.message + ' (stack: ' + e.stack + ')');
  }
}

function testPointNormalization() {
  const testData = [
    {x: 10, y: 0},
    {x: 15, y: "1.23e-8"},
    {x: 20, y: "0.5"},
    {x: 30, y: "1"}
  ];
  console.log('Starting normalizePoints test...');
  const normalized = normalizePoints(testData);
  console.log('Test result: processed ' + testData.length + ' → kept ' + normalized.length);
  normalized.forEach((p, i) => {
    console.log('Test point #' + (i+1) + ': x=' + p.x + ', y=' + p.y + ' (type: ' + typeof p.y + ')');
  });
}

/************************************************************
 * 14. PMC TASK MANAGER — Settings, Tab Management, Simulation
 ************************************************************/

var PMC_TAB_SCHEMA     = ['task_name','best_case','most_likely','worst_case','risk_weight','active','notes'];
var PMC_TAB_HDR_LABELS = ['Task Name','Best Case','Most Likely','Worst Case','Risk Weight','Active','Notes'];
var PMC_TAB_DEFAULT_NAME = 'ProjectCare Tasks';
var PMC_SETTINGS_KEY   = 'pmc_settings_v1';
var PMC_TAB_ID_KEY     = 'pmc_tab_id_v1';

function getPMCSettings() {
  try {
    var props = PropertiesService.getDocumentProperties();
    var raw   = props.getProperty(PMC_SETTINGS_KEY);
    var defs  = { tabName: PMC_TAB_DEFAULT_NAME, units: 'days', mode: 'single' };
    if (!raw) return defs;
    return Object.assign(defs, JSON.parse(raw));
  } catch(e) {
    return { tabName: PMC_TAB_DEFAULT_NAME, units: 'days', mode: 'single' };
  }
}

function savePMCSettings(settings) {
  try {
    var props   = PropertiesService.getDocumentProperties();
    var current = getPMCSettings();
    var merged  = Object.assign(current, settings || {});
    props.setProperty(PMC_SETTINGS_KEY, JSON.stringify(merged));
    return { ok: true, settings: merged };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

function listSheetTabs() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheets().map(function(sh) {
    return { name: sh.getName(), id: sh.getSheetId() };
  });
}

// Internal: find PMC sheet by tracked ID, then name fallback
function getPMCSheet_() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var props = PropertiesService.getDocumentProperties();
  var rawId = props.getProperty(PMC_TAB_ID_KEY);
  var savedId = rawId ? parseInt(rawId, 10) : NaN;
  if (!isNaN(savedId)) {
    var sheets = ss.getSheets();
    for (var i = 0; i < sheets.length; i++) {
      if (sheets[i].getSheetId() === savedId) return sheets[i];
    }
  }
  var settings = getPMCSettings();
  return ss.getSheetByName(settings.tabName || PMC_TAB_DEFAULT_NAME);
}

function initPMCTab(tabName) {
  tabName = tabName || PMC_TAB_DEFAULT_NAME;
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var props = PropertiesService.getDocumentProperties();

  // Already tracked?
  var existing = getPMCSheet_();
  if (existing) {
    props.setProperty(PMC_TAB_ID_KEY, String(existing.getSheetId()));
    savePMCSettings({ tabName: existing.getName() });
    return { ok: true, created: false, tabName: existing.getName(), tabId: existing.getSheetId() };
  }

  // Tab with requested name exists but not tracked?
  var byName = ss.getSheetByName(tabName);
  if (byName) {
    props.setProperty(PMC_TAB_ID_KEY, String(byName.getSheetId()));
    savePMCSettings({ tabName: tabName });
    return { ok: true, created: false, tabName: tabName, tabId: byName.getSheetId() };
  }

  // Create new tab
  var newSheet = ss.insertSheet(tabName);
  var hdr = newSheet.getRange(1, 1, 1, PMC_TAB_HDR_LABELS.length);
  hdr.setValues([PMC_TAB_HDR_LABELS]);
  hdr.setFontWeight('bold');
  hdr.setBackground('#e8f0fe');
  newSheet.setFrozenRows(1);
  var widths = [200, 100, 110, 110, 100, 70, 250];
  widths.forEach(function(w, ci) { newSheet.setColumnWidth(ci + 1, w); });
  props.setProperty(PMC_TAB_ID_KEY, String(newSheet.getSheetId()));
  savePMCSettings({ tabName: tabName });
  return { ok: true, created: true, tabName: tabName, tabId: newSheet.getSheetId() };
}

function detectColumnMapping(tabName) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) return { ok: false, error: 'Tab not found: ' + tabName };

  var lastCol = Math.min(sheet.getLastColumn(), 30);
  if (lastCol < 1) return { ok: false, error: 'Tab appears to be empty' };

  var headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

  var KEYWORDS = {
    task_name:   ['task','name','activity','item','work','feature','story','epic','title','description','id'],
    best_case:   ['best','optimistic','min','minimum','low','fast','fastest','floor','opt'],
    most_likely: ['likely','expected','nominal','typical','modal','base','medium','normal','mid','ml'],
    worst_case:  ['worst','pessimistic','max','maximum','high','slow','slowest','ceiling','pess'],
    risk_weight: ['risk','weight','priority','impact','severity','criticality','factor','wt'],
    active:      ['active','enabled','include','selected','on','use','flag'],
    notes:       ['note','comment','remark','detail','info','memo']
  };

  var mapping = {}, usedCols = {};
  PMC_TAB_SCHEMA.forEach(function(field) {
    var bestScore = 0, bestCol = -1;
    var keywords  = KEYWORDS[field] || [];
    headerRow.forEach(function(header, ci) {
      if (usedCols[ci]) return;
      var h = String(header || '').toLowerCase().trim().replace(/[\s_\-]+/g, '');
      if (!h) return;
      var score = 0;
      keywords.forEach(function(kw) {
        var k = kw.replace(/[\s_\-]+/g, '');
        if (h === k) score = Math.max(score, 10);
        else if (h.indexOf(k) !== -1 || k.indexOf(h) !== -1) score = Math.max(score, 5);
      });
      if (score > bestScore) { bestScore = score; bestCol = ci; }
    });
    mapping[field] = bestScore > 0 ? bestCol : -1;
    if (bestScore > 0) usedCols[bestCol] = true;
  });

  return {
    ok: true,
    mapping: mapping,
    headers: headerRow,
    totalRows: Math.max(0, sheet.getLastRow() - 1)
  };
}

function importFromExistingTab(tabName, mapping) {
  var ss       = SpreadsheetApp.getActiveSpreadsheet();
  var srcSheet = ss.getSheetByName(tabName);
  if (!srcSheet) return { ok: false, error: 'Source tab not found: ' + tabName };

  var lastRow = srcSheet.getLastRow();
  if (lastRow < 2) return { ok: true, tasks: [], warnings: ['Tab has no data rows'] };

  var colIndices = PMC_TAB_SCHEMA.map(function(f) { return (mapping[f] >= 0) ? mapping[f] : -1; });
  var maxCol     = Math.max.apply(null, colIndices.filter(function(c) { return c >= 0; })) + 1;
  var data       = srcSheet.getRange(2, 1, lastRow - 1, maxCol).getValues();
  var tasks = [], warnings = [];

  data.forEach(function(row, ri) {
    function get(field) {
      var ci = mapping[field];
      return (ci >= 0 && ci < row.length) ? row[ci] : '';
    }
    var name = String(get('task_name') || '').trim();
    if (!name) return;

    var a = parseFloat(get('best_case'));
    var c = parseFloat(get('most_likely'));
    var b = parseFloat(get('worst_case'));
    var w = parseFloat(get('risk_weight'));
    var actRaw = get('active');
    var active = actRaw === ''
      ? true
      : !(String(actRaw).toLowerCase() === 'false' || actRaw === '0' || actRaw === false || actRaw === 0);

    if (isNaN(a) || isNaN(c) || isNaN(b)) {
      warnings.push('Row ' + (ri + 2) + ' (' + name + '): Non-numeric estimates — skipped');
      return;
    }

    // Auto-correct ordering
    var sorted = [a, c, b].sort(function(x, y) { return x - y; });
    if (a !== sorted[0] || c !== sorted[1] || b !== sorted[2]) {
      warnings.push('Row ' + (ri + 2) + ' (' + name + '): Values re-sorted (best ≤ most likely ≤ worst)');
      a = sorted[0]; c = sorted[1]; b = sorted[2];
    }
    if (a === b) warnings.push('Row ' + (ri + 2) + ' (' + name + '): Zero-variance task (all values equal)');

    tasks.push({
      task_name:   name,
      best_case:   a,
      most_likely: c,
      worst_case:  b,
      risk_weight: isNaN(w) ? 1.0 : Math.max(0, Math.min(10, w)),
      active:      active,
      notes:       String(get('notes') || '').trim()
    });
  });

  return { ok: true, tasks: tasks, warnings: warnings };
}

function loadPMCTasks() {
  var sheet = getPMCSheet_();
  if (!sheet) return { ok: false, needsSetup: true, error: 'ProjectCare Tasks tab not found' };

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: true, tasks: [], tabName: sheet.getName(), tabId: sheet.getSheetId() };

  var data  = sheet.getRange(2, 1, lastRow - 1, PMC_TAB_SCHEMA.length).getValues();
  var tasks = [];
  data.forEach(function(row, i) {
    var name = String(row[0] || '').trim();
    if (!name) return;
    var a = parseFloat(row[1]);
    var c = parseFloat(row[2]);
    var b = parseFloat(row[3]);
    if (isNaN(a) || isNaN(c) || isNaN(b)) return;
    var w   = parseFloat(row[4]);
    var act = row[5];
    var active = act === '' ? true
      : !(String(act).toLowerCase() === 'false' || act === false || act === 0);
    tasks.push({
      id:          'tid_' + i,
      task_name:   name,
      best_case:   a,
      most_likely: c,
      worst_case:  b,
      risk_weight: isNaN(w) ? 1.0 : w,
      active:      active,
      notes:       String(row[6] || '').trim()
    });
  });

  return { ok: true, tasks: tasks, tabName: sheet.getName(), tabId: sheet.getSheetId() };
}

function savePMCTasksAndRun(payload) {
  if (!payload || !Array.isArray(payload.tasks))
    return { ok: false, error: 'Invalid payload: tasks array required' };

  var tabName = (payload.settings && payload.settings.tabName) || null;
  var initRes = initPMCTab(tabName);
  if (!initRes.ok) return { ok: false, error: 'Could not init PMC tab: ' + (initRes.error || '') };

  if (payload.settings) savePMCSettings(payload.settings);

  var sheet = getPMCSheet_();
  if (!sheet) return { ok: false, error: 'ProjectCare Tasks tab not found after init' };

  var lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, PMC_TAB_SCHEMA.length).clearContent();

  if (payload.tasks.length > 0) {
    var rows = payload.tasks.map(function(t) {
      return [
        String(t.task_name  || '').trim(),
        Number(t.best_case)   || 0,
        Number(t.most_likely) || 0,
        Number(t.worst_case)  || 0,
        Number(t.risk_weight) || 1.0,
        t.active === false ? false : true,
        String(t.notes || '').trim()
      ];
    });
    sheet.getRange(2, 1, rows.length, PMC_TAB_SCHEMA.length).setValues(rows);
  }

  try {
    var simResult = runPMCSimulation(payload);
    return Object.assign({ ok: true, savedCount: payload.tasks.length }, simResult);
  } catch(e) {
    return { ok: false, error: 'Save OK but simulation failed: ' + e.message, savedCount: payload.tasks.length };
  }
}

function runPMCSimulation(payload) {
  var activeTasks = (payload.tasks || []).filter(function(t) { return t.active !== false; });
  if (activeTasks.length === 0) return { ok: false, error: 'No active tasks to simulate' };

  var mode = payload.mode || 'single';
  var tau  = Number(payload.targetValue);
  var conf = Number(payload.confidenceLevel) || 0.95;

  if (mode === 'single') {
    var selId = payload.selectedTaskId;
    var task  = null;
    if (selId) task = activeTasks.filter(function(t) { return t.id === selId || t.task_name === selId; })[0] || null;
    if (!task) task = activeTasks[0];
    if (isNaN(tau)) tau = (task.best_case + 4 * task.most_likely + task.worst_case) / 6;

    var result = getTargetProbabilityData({
      task:            task.task_name,
      optimistic:      task.best_case,
      mostLikely:      task.most_likely,
      pessimistic:     task.worst_case,
      targetValue:     tau,
      confidenceLevel: conf,
      isOptimizeMode:  !!(payload.isOptimizeMode),
      optimize:        !!(payload.optimize),
      adaptive:        !!(payload.adaptive),
      sliderValues:    payload.sliderValues,
      mode:            payload.optimizeFor || 'target'
    });
    return { ok: true, mode: 'single', task: task.task_name, result: result };

  } else {
    // Aggregate: run each task, then convolve PDFs via MC sampling
    var taskResults = [], errors = [];
    activeTasks.forEach(function(t) {
      var taskTau = isNaN(tau) ? (t.best_case + 4 * t.most_likely + t.worst_case) / 6 : tau;
      try {
        var res = getTargetProbabilityData({
          task: t.task_name, optimistic: t.best_case,
          mostLikely: t.most_likely, pessimistic: t.worst_case,
          targetValue: taskTau, confidenceLevel: conf
        });
        taskResults.push({ task: t, simResult: res, weight: t.risk_weight || 1.0 });
      } catch(e2) {
        errors.push({ task: t.task_name, error: e2.message });
      }
    });
    if (taskResults.length === 0) return { ok: false, error: 'All tasks failed simulation', errors: errors };

    // PERT aggregation: for sequential independent tasks, the group 3-point estimate
    // is the SUM of each task's O, M, and P values (not the average).
    // This is mathematically sound: E[Sum] = Sum of E[tasks], and the summed O/M/P
    // yields the correct PERT mean = (groupO + 4·groupM + groupP)/6.
    var groupO = 0, groupM = 0, groupP = 0;
    activeTasks.forEach(function(t) {
      groupO += (Number(t.best_case)   || 0);
      groupM += (Number(t.most_likely) || 0);
      groupP += (Number(t.worst_case)  || 0);
    });

    var aggResult = computeAggregatePDF(taskResults, isNaN(tau) ? null : tau);
    return {
      ok: true, mode: 'aggregate', taskCount: taskResults.length, errors: errors, result: aggResult,
      groupO: groupO, groupM: groupM, groupP: groupP,
      groupPert: (groupO + 4 * groupM + groupP) / 6,
      taskResults: taskResults.map(function(tr) { return { task: tr.task.task_name, result: tr.simResult }; })
    };
  }
}

function computeAggregatePDF(taskResults, targetValue) {
  var N = 5000, BINS = 100;
  var sums = [];
  for (var i = 0; i < N; i++) sums.push(0);
  taskResults.forEach(function(tr) {
    var t = tr.task;
    var w = tr.weight || 1.0;
    for (var i = 0; i < N; i++) sums[i] += samplePERT_(t.best_case, t.most_likely, t.worst_case) * w;
  });
  sums.sort(function(a, b) { return a - b; });
  var minV = sums[0], maxV = sums[N - 1];
  var range = (maxV - minV) || 1;
  var bw    = range / BINS;
  var bins  = [];
  for (var j = 0; j < BINS; j++) bins.push(0);
  sums.forEach(function(v) { bins[Math.min(BINS - 1, Math.floor((v - minV) / bw))]++; });

  var pdfPts = [], cdfPts = [], cum = 0;
  bins.forEach(function(cnt, bi) {
    var x = minV + (bi + 0.5) * bw;
    cum += cnt / N;
    pdfPts.push({ x: x, y: cnt / (N * bw) });
    cdfPts.push({ x: x, y: Math.min(1, cum) });
  });

  var mean = sums.reduce(function(a, b) { return a + b; }, 0) / N;
  var probAtTgt = (targetValue != null && isFinite(targetValue))
    ? sums.filter(function(v) { return v <= targetValue; }).length / N
    : null;

  return {
    ok: true, pdfPoints: pdfPts, cdfPoints: cdfPts, mean: mean,
    p50: sums[Math.floor(N * 0.50)], p80: sums[Math.floor(N * 0.80)],
    p90: sums[Math.floor(N * 0.90)], p95: sums[Math.floor(N * 0.95)],
    min: minV, max: maxV, probAtTarget: probAtTgt, targetValue: targetValue,
    taskCount: taskResults.length, nSamples: N
  };
}

// Triangle distribution inverse-CDF sampler (PERT approximation)
function samplePERT_(a, c, b) {
  if (a >= b) return a;
  var u = Math.random(), fc = (c - a) / (b - a);
  return u < fc
    ? a + Math.sqrt(u * (b - a) * (c - a))
    : b - Math.sqrt((1 - u) * (b - a) * (b - c));
}
