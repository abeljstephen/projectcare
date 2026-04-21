/**
 * webapp.gs — ProjectCare API
 *
 * Exposes projectcareAPI to the Custom GPT via HTTP POST.
 * All key validation and quota management is handled by the
 * WordPress ProjectCare CRM plugin at icarenow.io/wp-json/projectcare/v1/
 *
 * Script Properties required (set via setup-wp-crm-connection.gs):
 *   WP_URL        — https://icarenow.io
 *   WP_API_SECRET — shared secret matching WordPress ProjectCare CRM settings
 *
 * Endpoints (all POST to this web app URL):
 *   action: "request_trial"  — forward trial request to WordPress
 *   action: "call_api"       — validate key, run estimation, deduct credits
 *   action: "check_quota"    — return current quota for a key
 */

// ── GAS-SIDE RATE LIMITING ────────────────────────────────────────────────────
// Uses CacheService (in-memory, per-instance) as a counter.
// Limits: 30 call_api per key per minute; 10 validate failures per key per hour.
var GAS_RATE_LIMITS = {
  call_api_per_min:       30,
  validate_fail_per_hour: 10
};

/**
 * Increment a rate-limit counter stored in CacheService.
 * Returns true if limit is exceeded (request should be rejected).
 * key: cache key, limit: max count, ttl: window in seconds.
 */
function gasRateLimitExceeded(cacheKey, limit, ttlSeconds) {
  try {
    var cache   = CacheService.getScriptCache();
    var current = parseInt(cache.get(cacheKey) || '0', 10);
    if (current >= limit) return true;
    cache.put(cacheKey, String(current + 1), ttlSeconds);
    return false;
  } catch (e) {
    // If cache is unavailable, fail open (don't block legitimate requests)
    console.warn('[ProjectCare] Rate limit cache error:', e.message);
    return false;
  }
}

// ── GAS AUDIT LOG ─────────────────────────────────────────────────────────────
// Lightweight append-only log to Script Properties (last 100 entries, circular).
// Used independently of WordPress logs so evidence survives if WP is compromised.
var GAS_AUDIT_MAX = 100;

function gasAuditLog(event, keyPrefix, detail) {
  try {
    var props = PropertiesService.getScriptProperties();
    var raw   = props.getProperty('GAS_AUDIT_LOG') || '[]';
    var log   = JSON.parse(raw);
    log.push({
      ts:  new Date().toISOString(),
      ev:  event,
      k:   keyPrefix || '',
      d:   String(detail || '').slice(0, 200)
    });
    // Keep only the last GAS_AUDIT_MAX entries
    if (log.length > GAS_AUDIT_MAX) log = log.slice(-GAS_AUDIT_MAX);
    props.setProperty('GAS_AUDIT_LOG', JSON.stringify(log));
  } catch (e) {
    console.warn('[ProjectCare] Audit log error:', e.message);
  }
}

// ── CREDIT COSTS PER OPERATION ────────────────────────────────────────────────
var CREDIT_COSTS = {
  baseline_only: 1,
  full_saco:     2,
  saco_explain:  4
};

// Credit cost for slim tier — always 1 regardless of operationType
var SLIM_CREDIT_COST = 1;

// ── ENTRY POINT ───────────────────────────────────────────────────────────────
function doPost(e) {
  try {
    // [A] Guard: reject missing/oversized bodies before parsing (DoS protection)
    if (!e || !e.postData || typeof e.postData.contents !== 'string') {
      return jsonOut({ error: 'Invalid request' });
    }
    if (e.postData.contents.length > 524288) {  // 512 KB hard limit
      return jsonOut({ error: 'Request body too large (max 512 KB)' });
    }
    var body = JSON.parse(e.postData.contents);
    var action = body.action || '';

    if (action === 'request_trial') return handleTrial(body);
    if (action === 'call_api')      return handleCallApi(body);
    if (action === 'check_quota')   return handleCheckQuota(body);
    if (action === 'save_session')  return handleSaveSession(body);
    if (action === 'load_sessions') return handleLoadSessions(body);
    if (action === 'ping')          return handlePing(body);
    if (action === 'benchmark')     return handleBenchmark(body);

    return jsonOut({ error: 'Unknown action: ' + action });

  } catch (err) {
    console.error('[ProjectCare API] doPost error:', err.message, err.stack);
    return jsonOut({ error: 'Server error. Please try again or contact support at icarenow.io.' });
  }
}

// ── TRIAL REQUEST ─────────────────────────────────────────────────────────────
function handleTrial(body) {
  var email = (body.email || '').trim().toLowerCase();
  // RFC 5321 practical validation: local@domain.tld with no spaces
  var emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  if (!email || !emailPattern.test(email))
    return jsonOut({ error: 'A valid email address is required' });

  var resp = wpPost('/projectcare/v1/trial', { email: email });
  return jsonOut(resp);
}

// ── ESTIMATION CALL ───────────────────────────────────────────────────────────
function handleCallApi(body) {
  var key = (body.key || '').trim();
  if (!key) return jsonOut({ error: 'API key is required' });

  // GAS-side rate limit: max 30 call_api per key per minute
  var keyPrefix = key.slice(0, 8);
  var rlKey = 'rl_ca_' + key.slice(0, 16);
  if (gasRateLimitExceeded(rlKey, GAS_RATE_LIMITS.call_api_per_min, 60)) {
    gasAuditLog('rate_limit', keyPrefix, 'call_api');
    return jsonOut({ error: 'Too many requests — please wait before retrying.' });
  }

  // Session token — stable for the life of one conversation.
  var sessionToken = (body.session_token || '').trim();
  if (!/^[a-f0-9]{32,64}$/.test(sessionToken)) {
    sessionToken = Utilities.getUuid().replace(/-/g, '');
  }

  // 1. Validate key + get quota from WordPress CRM
  var auth = wpPost('/projectcare/v1/validate', { key: key });
  if (!auth.valid) {
    // Audit log every failed validation (brute-force detection)
    var failKey = 'rl_vf_' + key.slice(0, 16);
    var tooMany = gasRateLimitExceeded(failKey, GAS_RATE_LIMITS.validate_fail_per_hour, 3600);
    gasAuditLog('auth_fail', keyPrefix, auth.error || 'invalid');
    if (tooMany) {
      return jsonOut({ error: 'Too many failed attempts. Please check your API key or contact support.' });
    }
    return jsonOut({ error: auth.error, upgrade_url: auth.upgrade_url });
  }
  gasAuditLog('call_api_ok', keyPrefix, (body.operationType || 'full_saco'));

  // 1b. Branch to slim handler when plan tier is 'slim'.
  //     gas_tier is returned by /validate once WordPress has the column (step 2).
  //     Until then defaults to 'full' so existing plans are unaffected.
  var gasTier = (auth.gas_tier || 'full').toLowerCase();
  if (gasTier === 'slim') {
    return handleCallApiSlim(body, key, auth, sessionToken);
  }

  // 2. Determine credit cost — GAS canonical values are the ceiling.
  //    WordPress may return lower costs (promotional pricing) but NEVER higher.
  //    Minimum enforced cost is always 1 to prevent free-ride attacks.
  var opType = body.operationType || 'full_saco';
  if (!CREDIT_COSTS[opType])
    return jsonOut({ error: 'Unknown operationType: ' + opType + '. Valid values: baseline_only, full_saco, saco_explain' });
  var canonicalCost = CREDIT_COSTS[opType];
  var liveCosts = (auth.credit_costs && typeof auth.credit_costs === 'object') ? auth.credit_costs : {};
  var wpCost = (liveCosts[opType] != null) ? parseInt(liveCosts[opType], 10) : NaN;
  // Accept WP cost only if: numeric, ≥1 (min floor), ≤ canonical (no upward manipulation)
  var cost = (!isNaN(wpCost) && wpCost >= 1 && wpCost <= canonicalCost) ? wpCost : canonicalCost;

  if (auth.remaining < cost) {
    return jsonOut({
      error: 'Insufficient credits — need ' + cost + ', have ' + auth.remaining + '.',
      upgrade_url: auth.upgrade_url || getWpUrl()
    });
  }

  // 3. Validate tasks input
  var tasks = body.tasks;
  if (!Array.isArray(tasks) || tasks.length === 0)
    return jsonOut({ error: 'At least one task is required' });
  if (tasks.length > 10)
    return jsonOut({ error: 'Maximum 10 tasks per request, got ' + tasks.length });

  for (var i = 0; i < tasks.length; i++) {
    var t = tasks[i];
    if (!t.task)        return jsonOut({ error: 'Task ' + (i+1) + ' is missing a name' });
    if (t.optimistic  == null) return jsonOut({ error: 'Task "' + t.task + '" is missing optimistic value' });
    if (t.mostLikely  == null) return jsonOut({ error: 'Task "' + t.task + '" is missing mostLikely value' });
    if (t.pessimistic == null) return jsonOut({ error: 'Task "' + t.task + '" is missing pessimistic value' });

    // Validate numeric values are finite and within a safe computation range
    var oNum = Number(t.optimistic), mNum = Number(t.mostLikely), pNum = Number(t.pessimistic);
    if (!Number.isFinite(oNum) || !Number.isFinite(mNum) || !Number.isFinite(pNum))
      return jsonOut({ error: 'Task "' + t.task + '": optimistic, mostLikely, and pessimistic must be finite numbers' });
    if (Math.abs(oNum) > 1e9 || Math.abs(mNum) > 1e9 || Math.abs(pNum) > 1e9)
      return jsonOut({ error: 'Task "' + t.task + '": values must be between -1,000,000,000 and 1,000,000,000' });

    if (t.optimistic > t.mostLikely || t.mostLikely > t.pessimistic)
      return jsonOut({ error: 'Task "' + t.task + '": values must satisfy optimistic ≤ mostLikely ≤ pessimistic' });

    // Validate sliderValues bounds if provided
    if (t.sliderValues && typeof t.sliderValues === 'object') {
      var SLIDER_BOUNDS = {
        budgetFlexibility:        100,
        scheduleFlexibility:      100,
        scopeCertainty:           100,
        scopeReductionAllowance:  100,
        reworkPercentage:          50,
        riskTolerance:            100,
        userConfidence:           100
      };
      var sliderKeys = Object.keys(SLIDER_BOUNDS);
      for (var s = 0; s < sliderKeys.length; s++) {
        var sk = sliderKeys[s];
        if (t.sliderValues[sk] == null) continue;
        var sv = Number(t.sliderValues[sk]);
        if (!Number.isFinite(sv) || sv < 0 || sv > SLIDER_BOUNDS[sk])
          return jsonOut({ error: 'Task "' + t.task + '": sliderValues.' + sk + ' must be 0–' + SLIDER_BOUNDS[sk] + ', got ' + t.sliderValues[sk] });
      }
    }

    // Validate confidenceTarget if provided (integer 1–99 percentile)
    if (t.confidenceTarget != null) {
      var ctNum0 = Number(t.confidenceTarget);
      if (!Number.isInteger(ctNum0) || ctNum0 < 1 || ctNum0 > 99)
        return jsonOut({ error: 'Task "' + t.task + '": confidenceTarget must be an integer 1–99, got ' + t.confidenceTarget });
    }

    // Validate parallel flag
    if (t.parallel != null && typeof t.parallel !== 'boolean')
      return jsonOut({ error: 'Task "' + t.task + '": parallel must be a boolean' });

    // Validate scenarios if provided (max 5 per task)
    if (t.scenarios != null) {
      if (!Array.isArray(t.scenarios))
        return jsonOut({ error: 'Task "' + t.task + '": scenarios must be an array' });
      if (t.scenarios.length > 5)
        return jsonOut({ error: 'Task "' + t.task + '": maximum 5 scenarios per task, got ' + t.scenarios.length });
      for (var sc = 0; sc < t.scenarios.length; sc++) {
        var scn = t.scenarios[sc];
        if (!scn.name)
          return jsonOut({ error: 'Task "' + t.task + '": scenario ' + (sc+1) + ' is missing a name' });
        if (scn.targetValue == null && scn.sliderValues == null)
          return jsonOut({ error: 'Task "' + t.task + '": scenario "' + scn.name + '" must have targetValue or sliderValues' });
        if (scn.targetValue != null && !Number.isFinite(Number(scn.targetValue)))
          return jsonOut({ error: 'Task "' + t.task + '": scenario "' + scn.name + '": targetValue must be a finite number' });
      }
    }
  }

  // 4. Run SACO estimation engine
  var engineStart = Date.now();
  var result;
  try {
    result = projectcareAPI(tasks);
  } catch (err) {
    console.error('[ProjectCare API] Engine error:', err.message, err.stack);
    return jsonOut({ error: 'Estimation engine error. Please try again or contact support at icarenow.io.' });
  }
  var durationMs = Date.now() - engineStart;

  // 5. Build chart URLs (report URL built after enrichment — needs percentiles/probs).
  //    Charts represent task[0] distribution.
  if (tasks.length > 0 && result.results && result.results[0]) {
    result._sacoCharts = buildChartUrls(result.results[0], tasks[0]);
  }

  // 8. Enrich per-task results: full percentile table, sensitivity, scenario batch, target-advisor.
  //    Must run before slimResult strips the CDF arrays.
  //    Depends on invertCdf/computeSliderProbability/interpolateCdf in GAS global scope.
  if (result.results && Array.isArray(result.results)) {
    for (var ri = 0; ri < result.results.length; ri++) {
      var rItem       = result.results[ri];
      var rInTask     = ri < tasks.length ? tasks[ri] : null;  // guard: results must not exceed tasks
      var rBasePoints = (rItem.baseline && rItem.baseline.monteCarloSmoothed) || null;
      var rCdf        = (rBasePoints && rBasePoints.cdfPoints) || [];

      if (rCdf.length) {
        // Full percentile table P5–P95
        rItem.percentiles = {
          p5:  invertCdf(rCdf, 0.05),
          p10: invertCdf(rCdf, 0.10),
          p20: invertCdf(rCdf, 0.20),
          p30: invertCdf(rCdf, 0.30),
          p40: invertCdf(rCdf, 0.40),
          p50: invertCdf(rCdf, 0.50),
          p60: invertCdf(rCdf, 0.60),
          p70: invertCdf(rCdf, 0.70),
          p80: invertCdf(rCdf, 0.80),
          p90: invertCdf(rCdf, 0.90),
          p95: invertCdf(rCdf, 0.95)
        };
        // targetAtConfidence — only when confidenceTarget was requested for this task
        var ctNum = rInTask && rInTask.confidenceTarget != null
                    ? Number(rInTask.confidenceTarget) : null;
        if (ctNum !== null) {
          rItem.targetAtConfidence = {
            confidence: ctNum,
            value:      invertCdf(rCdf, ctNum / 100)
          };
        }
      }

      // Sensitivity summary — capped at first 5 tasks to guard GAS execution time.
      // At 8 computeSliderProbability calls per task, 10 tasks = 80 calls → timeout risk.
      if (rInTask && rInTask.targetValue != null && rBasePoints) {
        if (ri < 5) {
          try {
            rItem.sensitivity = computeSensitivityBlock(rInTask, rBasePoints);
          } catch (e) {
            console.error('[ProjectCare API] Sensitivity error for task ' + ri + ':', e.message);
          }
        } else {
          rItem.sensitivitySkipped = true;  // omitted to prevent execution timeout
        }
      }

      // Scenario batch — requires scenarios array and baseline points
      if (rInTask && Array.isArray(rInTask.scenarios) && rInTask.scenarios.length && rBasePoints) {
        try {
          rItem.scenarios = computeScenarioBatch(rInTask, rBasePoints);
        } catch (e) {
          console.error('[ProjectCare API] Scenario error for task ' + ri + ':', e.message);
        }
      }

      // Optimized CDF percentiles (P10/P50/P90 on SACO-reshaped distribution).
      // Shows how SACO shifts the distribution, not just the probability at target.
      var rOptCdf = (rItem.optimize && rItem.optimize.reshapedPoints &&
                     rItem.optimize.reshapedPoints.cdfPoints) || [];
      if (rOptCdf.length) {
        rItem.optimizedPercentiles = {
          p10: invertCdf(rOptCdf, 0.10),
          p50: invertCdf(rOptCdf, 0.50),
          p90: invertCdf(rOptCdf, 0.90)
        };
      }

      // Slider delta — what SACO changed vs. user's input sliders (UI units).
      // Pulls winningSliders from the last decisionReport (Optimize mode).
      var rReports = rItem.decisionReports;
      var rWinSliders = null;
      if (Array.isArray(rReports)) {
        for (var rri = rReports.length - 1; rri >= 0; rri--) {
          if (rReports[rri] && rReports[rri].winningSliders &&
              typeof rReports[rri].winningSliders === 'object') {
            rWinSliders = rReports[rri].winningSliders;
            break;
          }
        }
      }
      if (rWinSliders && rInTask) {
        var rUserSliders = (rInTask.sliderValues && typeof rInTask.sliderValues === 'object')
          ? rInTask.sliderValues : {};
        var SLIDER_DEFS = {
          budgetFlexibility: 50, scheduleFlexibility: 50, scopeCertainty: 50,
          scopeReductionAllowance: 50, reworkPercentage: 25, riskTolerance: 50, userConfidence: 75
        };
        var DELTA_KEYS = ['budgetFlexibility','scheduleFlexibility','scopeCertainty',
          'scopeReductionAllowance','reworkPercentage','riskTolerance','userConfidence'];
        var sliderDelta = {};
        for (var dki = 0; dki < DELTA_KEYS.length; dki++) {
          var dKey = DELTA_KEYS[dki];
          var uVal = rUserSliders[dKey] != null ? Number(rUserSliders[dKey]) : SLIDER_DEFS[dKey];
          var sVal = rWinSliders[dKey]  != null ? Number(rWinSliders[dKey])  : uVal;
          var dDiff = Math.round((sVal - uVal) * 10) / 10;
          if (Math.abs(dDiff) >= 1) sliderDelta[dKey] = dDiff;
        }
        if (Object.keys(sliderDelta).length > 0) rItem.sliderDelta = sliderDelta;
      }

      // Feasibility score (0–100): P(SACO-optimized) discounted by tail risk.
      // Tail risk = (P90 − P50) / |P50|; values > 0.5 reduce score by up to 20 pts.
      // Only computed when a targetValue is present.
      var rTp = (rItem.targetProbability && rItem.targetProbability.value) || {};
      var rOptProb = rTp.adjustedOptimized != null ? Number(rTp.adjustedOptimized)
                   : rTp.adjusted          != null ? Number(rTp.adjusted)
                   : rTp.original          != null ? Number(rTp.original) : null;
      if (Number.isFinite(rOptProb) && rItem.percentiles) {
        var fP50 = rItem.percentiles.p50, fP90 = rItem.percentiles.p90;
        var tailRatio = (fP50 != null && Math.abs(fP50) > 0 && fP90 != null)
          ? Math.max(0, (fP90 - fP50) / Math.abs(fP50)) : 0;
        var tailPenalty = Math.max(0, Math.min(0.20, (tailRatio - 0.50) / 5));
        rItem.feasibilityScore = Math.max(0, Math.min(100,
          Math.round(rOptProb * (1 - tailPenalty) * 100)));
      }

      // Per-task SACO report URL (single-task view for this result item).
      if (rInTask) {
        try { rItem._sacoReportUrl = buildSacoReportUrl([rItem], [rInTask], sessionToken); } catch (e) {}
      }
    }
  }

  // Top-level report URL — built after enrichment so percentiles + probabilities are populated.
  if (tasks.length > 0 && result.results && result.results[0]) {
    try { result._sacoReportUrl = buildSacoReportUrl(result.results, tasks, sessionToken); } catch (e) {}
  }

  // Portfolio aggregation — only when CPM stochastic did NOT produce project duration.
  // If CPM ran successfully, _portfolio is suppressed: stochastic CPM already accounts for
  // task correlation and non-normality via its project duration distribution.
  // Fallback (no CPM): PERT sum / parallel max using SACO-optimized P50/P90 when available.
  var cpmStochOk = result.cpEngine &&
                   result.cpEngine.stochastic &&
                   result.cpEngine.stochastic.status === 'ok' &&
                   result.cpEngine.stochastic.projectDuration;

  if (tasks.length > 1 && !cpmStochOk) {
    var seqMean = 0, seqVar = 0;
    var parMeans = [], parVars = [];
    var hasParallel = false;
    for (var pIdx = 0; pIdx < tasks.length; pIdx++) {
      var pTask    = tasks[pIdx];
      var pResult  = result.results && result.results[pIdx];
      // Prefer SACO-optimized P50 as mean, derive variance from P10/P90 interval.
      // If SACO didn't run or didn't converge, fall back to raw PERT.
      var optPct   = pResult && pResult.optimizedPercentiles;
      var tMean, tVar;
      if (optPct && Number.isFinite(optPct.p50) && Number.isFinite(optPct.p10) && Number.isFinite(optPct.p90)) {
        tMean = optPct.p50;
        // Approximate σ from symmetric P10/P90: σ ≈ (P90 − P10) / (2 × 1.282)
        tVar  = Math.pow((optPct.p90 - optPct.p10) / 2.564, 2);
      } else {
        var pO = Number(pTask.optimistic), pM = Number(pTask.mostLikely), pP = Number(pTask.pessimistic);
        tMean = (pO + 4 * pM + pP) / 6;
        tVar  = Math.pow((pP - pO) / 6, 2);
      }
      if (pTask.parallel === true) {
        hasParallel = true;
        parMeans.push(tMean);
        parVars.push(tVar);
      } else {
        seqMean += tMean;
        seqVar  += tVar;
      }
    }
    if (parMeans.length > 0) {
      seqMean += Math.max.apply(null, parMeans);
      seqVar  += Math.max.apply(null, parVars);
    }
    var pStd = Math.sqrt(seqVar);
    if (Number.isFinite(seqMean) && Number.isFinite(pStd)) {
      result._portfolio = {
        taskCount: tasks.length,
        p10: Math.round((seqMean - 1.282 * pStd) * 100) / 100,
        p50: Math.round(seqMean                   * 100) / 100,
        p90: Math.round((seqMean + 1.282 * pStd)  * 100) / 100,
        method: hasParallel ? 'pert_critical_path_saco' : 'pert_sum_saco'
      };
    } else {
      console.error('[ProjectCare API] Portfolio NaN: seqMean=' + seqMean + ' pStd=' + pStd);
    }
  }

  // 6. Compute enrichment metrics for deduct payload
  var deductTaskCount = tasks.length;
  var deductHasSliders = 0;
  var feasibilityScores = [];
  if (result.results && Array.isArray(result.results)) {
    for (var di = 0; di < result.results.length; di++) {
      var dTask = di < tasks.length ? tasks[di] : null;
      if (!deductHasSliders && dTask && dTask.sliderValues && typeof dTask.sliderValues === 'object') {
        var sVals = Object.keys(dTask.sliderValues);
        for (var svi = 0; svi < sVals.length; svi++) {
          if (Number(dTask.sliderValues[sVals[svi]]) !== 0) { deductHasSliders = 1; break; }
        }
      }
      var dItem = result.results[di];
      if (dItem && dItem.feasibilityScore != null) feasibilityScores.push(dItem.feasibilityScore);
    }
  }
  var deductFeasibilityAvg = feasibilityScores.length
    ? Math.round(feasibilityScores.reduce(function(a, b) { return a + b; }, 0) / feasibilityScores.length)
    : 0;

  // 7. Deduct credits in WordPress CRM
  var deduct = wpPost('/projectcare/v1/deduct', {
    key:             key,
    cost:            cost,
    operation:       opType,
    duration_ms:     durationMs,
    gas_exec_count:  getDailyExecCount(),
    task_count:      deductTaskCount,
    has_sliders:     deductHasSliders,
    feasibility_avg: deductFeasibilityAvg
  });

  // 8. Build quota display block
  var remaining = deduct.remaining != null ? deduct.remaining : (auth.remaining - cost);
  var total     = deduct.total     != null ? deduct.total     : auth.total;
  var bar       = deduct.bar       || buildBar(total - remaining, total);

  result._quota = {
    plan:              auth.plan,
    expires:           auth.expires,
    operation:         opType,
    credits_this_call: cost,
    credits_remaining: remaining,
    credits_total:     total,
    bar:               bar
  };

  // 9. Build plot URL and save slim scalars to WordPress session poll.
  //    Uses slim-only data (no full PDF/CDF arrays) to avoid serialization latency
  //    that could push 3-task execution over the 30-second GAS web app timeout.
  //    The browser-side SACO engine recomputes full arrays on load.
  if (tasks.length > 0 && result.results && result.results[0]) {
    try {
      // Build slim scalars for each task (no arrays — fast to serialize)
      var slimTasks = tasks.map(function(task, i) {
        var res = result.results[i] || result.results[0];
        var winSliders = null;
        var rReports = res.decisionReports;
        if (Array.isArray(rReports)) {
          for (var ri = rReports.length - 1; ri >= 0; ri--) {
            if (rReports[ri] && rReports[ri].winningSliders) { winSliders = rReports[ri].winningSliders; break; }
          }
        }
        // userSliders: the slider values the user explicitly passed in this GPT call (UI units:
        // 0–100 for all sliders, 0–50 for reworkPercentage). null when no sliders were given.
        // Required by the plot page to pre-populate the manual overlay and run the manual variant.
        var uSliders = (task.sliderValues && typeof task.sliderValues === 'object' &&
                        Object.keys(task.sliderValues).length > 0)
                       ? task.sliderValues : null;
        // Keep only p10/p50/p90 — full percentile arrays bloat the URL
        var pct  = res.percentiles           || {};
        var opct = res.optimizedPercentiles  || {};
        var tp   = (res.targetProbability && res.targetProbability.value) || {};
        return {
          task:              task.task,
          O:                 task.optimistic,
          M:                 task.mostLikely,
          P:                 task.pessimistic,
          target:            task.targetValue != null ? task.targetValue : null,
          targetProbability: tp,
          p10:               pct.p10  != null ? pct.p10  : null,
          p50:               pct.p50  != null ? pct.p50  : null,
          p90:               pct.p90  != null ? pct.p90  : null,
          op10:              opct.p10 != null ? opct.p10 : null,
          op50:              opct.p50 != null ? opct.p50 : null,
          op90:              opct.p90 != null ? opct.p90 : null,
          feasibilityScore:  res.feasibilityScore != null ? res.feasibilityScore : null,
          winningSliders:    winSliders,
          userSliders:       uSliders
          // _sacoReportUrl intentionally omitted here — GPT surfaces it from top-level result._sacoReportUrl
        };
      });
      var sessionPayload = { tasks: slimTasks, portfolio: result._portfolio || null };
      // URL payload: bare-bones O/M/P seed only — browser fetches full results via session poll.
      // Keeps URL under ~800 chars even for 10 tasks.
      var urlTasks = tasks.map(function(t) {
        return { task: t.task, O: t.optimistic, M: t.mostLikely, P: t.pessimistic };
      });
      var sacoPlotUrl = buildSacoPlotUrl(urlTasks, tasks, sessionToken, null);
      var cpmUrl      = buildCpmUrl(tasks, sessionToken);
      result._sacoPlotUrl  = sacoPlotUrl;
      result._cpmUrl       = cpmUrl;
      result._sessionToken = sessionToken;
      // Save slim payload to WordPress for live-update polling (non-fatal)
      try {
        wpPost('/projectcare/v1/plot-data/save', { token: sessionToken, data: sessionPayload });
      } catch (saveErr) {
        console.error('[ProjectCare API] plot-data save failed:', saveErr.message);
      }
    } catch (plotErr) {
      console.error('[ProjectCare API] buildSacoPlotUrl error:', plotErr.message);
      result._sessionToken = sessionToken;
    }
  }

  // 10. Pre-slim cpEngine arrays before deepSlim runs its >10-element strip rule.
  //     sCurve is always 25 points (> 10 limit) → downsample to 9 key percentile points.
  //     tornado and criticalPath are kept as-is (usually short; cap at 10 for safety).
  if (result.cpEngine && result.cpEngine.status === 'ok') {
    var cpe = result.cpEngine;
    if (cpe.stochastic && cpe.stochastic.status === 'ok') {
      // Downsample sCurve to 9 key CDF points: P10 P20 P30 P40 P50 P60 P70 P80 P90
      var rawSC = cpe.stochastic.sCurve;
      if (Array.isArray(rawSC) && rawSC.length > 1) {
        var targets = [0.10, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 0.90];
        cpe.stochastic.sCurve = targets.map(function(p) {
          // Find the point where cumulative probability first reaches p
          for (var si = 0; si < rawSC.length; si++) {
            if (rawSC[si].y >= p) return { x: rawSC[si].x, y: rawSC[si].y };
          }
          return rawSC[rawSC.length - 1]; // fallback: last point
        });
      }
      // Cap tornado at top 10 (sorted by SSI desc — already sorted by engine)
      if (Array.isArray(cpe.stochastic.tornado) && cpe.stochastic.tornado.length > 10) {
        cpe.stochastic.tornado = cpe.stochastic.tornado.slice(0, 10);
      }
    }
    // criticalPath and nearCriticalTasks are usually short; cap defensively
    if (cpe.deterministic) {
      if (Array.isArray(cpe.deterministic.criticalPath) && cpe.deterministic.criticalPath.length > 10) {
        cpe.deterministic.criticalPath = cpe.deterministic.criticalPath.slice(0, 10);
      }
      if (Array.isArray(cpe.deterministic.nearCriticalTasks) && cpe.deterministic.nearCriticalTasks.length > 10) {
        cpe.deterministic.nearCriticalTasks = cpe.deterministic.nearCriticalTasks.slice(0, 10);
      }
      // topologicalOrder is internal — not needed by GPT; drop it to save payload space
      delete cpe.deterministic.topologicalOrder;
      delete cpe.deterministic.sources;
      delete cpe.deterministic.sinks;
      delete cpe.deterministic.orphanGroups;
    }
    // ssi is a raw object redundant with tornado; drop to save space
    if (cpe.stochastic) delete cpe.stochastic.ssi;
  }

  // 11. Strip large point arrays so response stays under GPT's ~100 KB limit
  result = slimResult(result);

  return jsonOut(result);
}

// ── SLIM TIER HANDLER ─────────────────────────────────────────────────────────
// PERT-only path: no SACO engine, no CPM.
// Runs in < 2 seconds, costs 1 credit.
// GPT gets PERT means + baseline probability approximation.
// The plot URL is pre-seeded with O/M/P so the browser runs full SACO on load.

/**
 * Abramowitz & Stegun 26.2.17 normal CDF approximation.
 * Max absolute error: 7.5e-8. Sufficient for conversational probability display.
 */
function _normalCdf(x) {
  if (x < -8) return 0;
  if (x >  8) return 1;
  var t   = 1 / (1 + 0.2316419 * Math.abs(x));
  var pdf = Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  var p   = 1 - pdf * t * (0.319381530
              + t * (-0.356563782
              + t * ( 1.781477937
              + t * (-1.821255978
              + t *   1.330274429))));
  return x >= 0 ? p : 1 - p;
}

/**
 * PERT statistics for a single task.
 * Returns { mean, std, p10, p25, p50, p75, p90 } using normal approximation.
 * Returns null if inputs are invalid.
 */
function _pertStats(task) {
  var O = Number(task.optimistic), M = Number(task.mostLikely), P = Number(task.pessimistic);
  if (!Number.isFinite(O) || !Number.isFinite(M) || !Number.isFinite(P)) return null;
  var mean = (O + 4 * M + P) / 6;
  var std  = (P - O) / 6;
  if (std <= 0) {
    // Degenerate: all three values equal
    return { mean: mean, std: 0, p10: mean, p25: mean, p50: mean, p75: mean, p90: mean };
  }
  var r = function(v) { return Math.round(v * 100) / 100; };
  return {
    mean: r(mean),
    std:  r(std),
    p10:  r(mean - 1.282 * std),
    p25:  r(mean - 0.674 * std),
    p50:  r(mean),
    p75:  r(mean + 0.674 * std),
    p90:  r(mean + 1.282 * std)
  };
}

/**
 * P(X ≤ target) under normal(mean, std). Returns null when std = 0 or target absent.
 */
function _pertProbAtTarget(task) {
  if (task.targetValue == null) return null;
  var stats = _pertStats(task);
  if (!stats || stats.std === 0) return null;
  var z = (Number(task.targetValue) - stats.mean) / stats.std;
  return Math.round(_normalCdf(z) * 10000) / 10000;
}

/**
 * Slim tier: validates key, computes PERT stats, builds plot URL, deducts 1 credit.
 * Called from handleCallApi when auth.gas_tier === 'slim'.
 */
function handleCallApiSlim(body, key, auth, sessionToken) {
  var tasks = body.tasks;
  if (!Array.isArray(tasks) || tasks.length === 0)
    return jsonOut({ error: 'At least one task is required' });
  if (tasks.length > 10)
    return jsonOut({ error: 'Maximum 10 tasks per request, got ' + tasks.length });

  // Basic task validation (same guards as full path)
  for (var i = 0; i < tasks.length; i++) {
    var t = tasks[i];
    if (!t.task)           return jsonOut({ error: 'Task ' + (i+1) + ' is missing a name' });
    if (t.optimistic  == null) return jsonOut({ error: 'Task "' + t.task + '" is missing optimistic value' });
    if (t.mostLikely  == null) return jsonOut({ error: 'Task "' + t.task + '" is missing mostLikely value' });
    if (t.pessimistic == null) return jsonOut({ error: 'Task "' + t.task + '" is missing pessimistic value' });
    if (t.optimistic > t.mostLikely || t.mostLikely > t.pessimistic)
      return jsonOut({ error: 'Task "' + t.task + '": values must satisfy optimistic ≤ mostLikely ≤ pessimistic' });
  }

  // Credit check — slim cost capped at canonical SLIM_CREDIT_COST; minimum 1
  var liveCostsSlim = (auth.credit_costs && typeof auth.credit_costs === 'object') ? auth.credit_costs : {};
  var wpSlimCost = (liveCostsSlim['slim'] != null) ? parseInt(liveCostsSlim['slim'], 10) : NaN;
  var slimCost = (!isNaN(wpSlimCost) && wpSlimCost >= 1 && wpSlimCost <= SLIM_CREDIT_COST)
    ? wpSlimCost : SLIM_CREDIT_COST;
  if (auth.remaining < slimCost) {
    return jsonOut({
      error:       'Insufficient credits — need ' + slimCost + ', have ' + auth.remaining + '.',
      upgrade_url: auth.upgrade_url || getWpUrl()
    });
  }

  var engineStart = Date.now();

  // Per-task PERT results (no SACO)
  var taskResults = tasks.map(function(task) {
    var stats     = _pertStats(task);
    var baseProb  = _pertProbAtTarget(task);
    return {
      task:         task.task,
      pert:         stats,
      baselineProb: baseProb,
      target:       task.targetValue != null ? task.targetValue : null
    };
  });

  // Portfolio: PERT sum (sequential) / critical path (parallel) — same logic as full path
  var portfolio = null;
  if (tasks.length > 1) {
    var seqMean = 0, seqVar = 0;
    var parMeans = [], parVars = [];
    var hasParallel = false;
    for (var pi = 0; pi < tasks.length; pi++) {
      var pt = tasks[pi];
      var s  = _pertStats(pt);
      if (!s) continue;
      var tVar = s.std * s.std;
      if (pt.parallel === true) {
        hasParallel = true;
        parMeans.push(s.mean);
        parVars.push(tVar);
      } else {
        seqMean += s.mean;
        seqVar  += tVar;
      }
    }
    if (parMeans.length > 0) {
      seqMean += Math.max.apply(null, parMeans);
      seqVar  += Math.max.apply(null, parVars);
    }
    var pStd = Math.sqrt(seqVar);
    if (Number.isFinite(seqMean) && Number.isFinite(pStd)) {
      portfolio = {
        taskCount: tasks.length,
        p10:    Math.round((seqMean - 1.282 * pStd) * 100) / 100,
        p50:    Math.round(seqMean                   * 100) / 100,
        p90:    Math.round((seqMean + 1.282 * pStd)  * 100) / 100,
        method: hasParallel ? 'pert_critical_path' : 'pert_sum'
      };
    }
  }

  var durationMs = Date.now() - engineStart;

  // Build slim task array for plot URL — same schema as full path.
  // winningSliders / optimizedPercentiles are absent (browser runs SACO on load).
  var slimTasks = tasks.map(function(task, i) {
    var stats    = _pertStats(task);
    var baseProb = _pertProbAtTarget(task);
    return {
      task:              task.task,
      O:                 task.optimistic,
      M:                 task.mostLikely,
      P:                 task.pessimistic,
      target:            task.targetValue != null ? task.targetValue : null,
      // targetProbability: only baseline available; adjusted/optimized left for browser SACO
      targetProbability: baseProb != null ? { original: baseProb } : {},
      percentiles:       stats ? {
        p10: stats.p10, p25: stats.p25, p50: stats.p50,
        p75: stats.p75, p90: stats.p90
      } : {},
      optimizedPercentiles: {},
      feasibilityScore:  null,
      winningSliders:    null,
      userSliders:       null,
      reportUrl:         null   // no SACO data → no report
    };
  });

  // Build SACO plot + CPM URLs and save to WP for session polling
  var sacoPlotUrl = buildSacoPlotUrl(slimTasks, tasks, sessionToken, portfolio);
  var cpmUrl      = buildCpmUrl(tasks, sessionToken);
  try {
    wpPost('/projectcare/v1/plot-data/save', {
      token: sessionToken,
      data:  { tasks: slimTasks, portfolio: portfolio }
    });
  } catch (saveErr) {
    console.error('[ProjectCare API] slim plot-data save failed:', saveErr.message);
  }

  // Deduct credit (cost resolved from WP or fallback to SLIM_CREDIT_COST)
  var deduct = wpPost('/projectcare/v1/deduct', {
    key:             key,
    cost:            slimCost,
    operation:       'baseline_only',
    duration_ms:     durationMs,
    gas_exec_count:  getDailyExecCount(),
    task_count:      tasks.length,
    has_sliders:     0,
    feasibility_avg: 0
  });

  var remaining = deduct.remaining != null ? deduct.remaining : (auth.remaining - slimCost);
  var total     = deduct.total     != null ? deduct.total     : auth.total;
  var bar       = deduct.bar       || buildBar(total - remaining, total);

  return jsonOut({
    tier:            'slim',
    results:         taskResults,
    _portfolio:      portfolio,
    _sacoPlotUrl:    sacoPlotUrl,
    _cpmUrl:         cpmUrl,
    _sessionToken:   sessionToken,
    _quota: {
      plan:              auth.plan,
      expires:           auth.expires,
      operation:         'baseline_only',
      credits_this_call: slimCost,
      credits_remaining: remaining,
      credits_total:     total,
      bar:               bar
    },
    _note: 'PERT approximation only — full SACO optimization runs automatically in the browser when the plot page opens.'
  });
}

// ── CHECK QUOTA ───────────────────────────────────────────────────────────────
function handleCheckQuota(body) {
  var key = (body.key || '').trim();
  if (!key) return jsonOut({ error: 'API key is required' });

  var resp = wpPost('/projectcare/v1/quota', { key: key });
  return jsonOut(resp);
}

// ── WORDPRESS HTTP HELPER ─────────────────────────────────────────────────────
function getWpUrl() {
  return PropertiesService.getScriptProperties().getProperty('WP_URL') || '';
}

function wpPost(path, payload) {
  var wpUrl  = getWpUrl();
  var secret = PropertiesService.getScriptProperties().getProperty('WP_API_SECRET') || '';

  if (!wpUrl || !secret) {
    console.error('[ProjectCare API] WP_URL or WP_API_SECRET not set in Script Properties');
    return { error: 'WordPress connection not configured' };
  }

  // Guard against SSRF — WP_URL must be icarenow.io over HTTPS.
  var _allowed = ['https://icarenow.io', 'https://www.icarenow.io'];
  if (_allowed.indexOf(wpUrl.toLowerCase().replace(/\/$/, '')) === -1) {
    console.error('[ProjectCare API] WP_URL rejected: ' + wpUrl);
    return { error: 'WordPress connection misconfigured' };
  }

  try {
    var resp = UrlFetchApp.fetch(wpUrl + '/wp-json' + path, {
      method:             'post',
      contentType:        'application/json',
      headers:            { 'X-Projectcare-Secret': secret },
      payload:            JSON.stringify(payload),
      muteHttpExceptions: true,
      followRedirects:    true
    });

    var code = resp.getResponseCode();
    var text = resp.getContentText();

    if (code !== 200) {
      console.error('[ProjectCare API] WP error ' + code + ':', text.substring(0, 200));
      return { error: 'WordPress returned HTTP ' + code };
    }

    return JSON.parse(text);

  } catch (err) {
    console.error('[ProjectCare API] WP fetch error:', err.message);
    return { error: 'Could not reach WordPress: ' + err.message };
  }
}

// ── RESPONSE TRIMMER ─────────────────────────────────────────────────────────
// The adapter spreads the full core object (deeply nested with PDF/CDF arrays).
// Arrays > 10 elements are distribution point data — strip them recursively.
// Strings > 1500 chars are truncated. Large known blobs are dropped by key.

var STRIP_KEYS = ['baselineCsv', 'decisionCsv', 'rawSamples', 'monteCarloPaths'];

function deepSlim(obj, depth) {
  if (depth === undefined) depth = 0;
  if (depth > 8) return '[…]';
  if (obj === null || obj === undefined) return obj;

  // Arrays: drop if large (distribution points); keep small arrays (sliders, flags)
  if (Array.isArray(obj)) {
    if (obj.length > 10) return undefined;  // stripped — caller should omit key
    return obj.map(function(item) { return deepSlim(item, depth + 1); })
              .filter(function(v) { return v !== undefined; });
  }

  // Strings: truncate long ones
  if (typeof obj === 'string') {
    return obj.length > 1500 ? obj.substring(0, 1500) + '…' : obj;
  }

  // Scalars: pass through
  if (typeof obj !== 'object') return obj;

  // Objects: recurse, drop known large keys and undefined values
  var out = {};
  Object.keys(obj).forEach(function(k) {
    if (!Object.prototype.hasOwnProperty.call(obj, k)) return;
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') return;
    if (STRIP_KEYS.indexOf(k) !== -1) return;
    var v = deepSlim(obj[k], depth + 1);
    if (v !== undefined) out[k] = v;
  });
  return out;
}

function slimResult(result) {
  if (!result || typeof result !== 'object') return result;
  return deepSlim(result, 0);
}

// ── CHART URL BUILDERS (QuickChart.io) ───────────────────────────────────────
function buildChartUrls(res, task) {
  var urls = {};
  try { urls.distribution  = buildDistributionChart(res, task); } catch(e) { console.error('[ProjectCare API] Distribution chart error:', e.message); }
  try { urls.probabilities = buildProbBarChart(res, task);       } catch(e) { console.error('[ProjectCare API] Prob bar chart error:', e.message); }
  return urls;
}

function sampleEvery(arr, maxPts) {
  if (!arr || !Array.isArray(arr) || arr.length <= maxPts) return arr;
  var step = Math.ceil(arr.length / maxPts);
  var out  = [];
  for (var i = 0; i < arr.length; i += step) out.push(arr[i]);
  return out;
}

function buildDistributionChart(res, task) {
  var basePdf = sampleEvery(
    (res.baseline && res.baseline.monteCarloSmoothed && res.baseline.monteCarloSmoothed.pdfPoints) || [], 40);
  var adjPdf  = sampleEvery(
    (res.optimize && res.optimize.reshapedPoints && res.optimize.reshapedPoints.pdfPoints) || [], 40);
  if (!basePdf.length && !adjPdf.length) return null;

  var labels   = (basePdf.length ? basePdf : adjPdf).map(function(p){ return Math.round(p.x); });
  var baseData = basePdf.map(function(p){ return p.y != null ? p.y.toFixed(4) : 0; });
  var adjData  = adjPdf.map(function(p){ return p.y != null ? p.y.toFixed(4) : 0; });

  var datasets = [];
  if (baseData.length) datasets.push({
    label: 'Baseline', data: baseData,
    borderColor: '#94A3B8', backgroundColor: 'rgba(148,163,184,0.15)',
    fill: true, tension: 0.4, pointRadius: 0
  });
  if (adjData.length) datasets.push({
    label: 'Optimized (SACO)', data: adjData,
    borderColor: '#3B82F6', backgroundColor: 'rgba(59,130,246,0.15)',
    fill: true, tension: 0.4, pointRadius: 0
  });

  var cfg = {
    type: 'line',
    data: { labels: labels, datasets: datasets },
    options: {
      plugins: { title: { display: true, text: 'Probability Distribution — ' + (task.task || '') } },
      scales: {
        x: { title: { display: true, text: 'Value' } },
        y: { title: { display: true, text: 'Density' } }
      }
    }
  };
  return 'https://quickchart.io/chart?width=600&height=320&c=' + encodeURIComponent(JSON.stringify(cfg));
}

function buildProbBarChart(res, task) {
  var tp    = (res.targetProbability && res.targetProbability.value) || {};
  var bProb = tp.original          != null ? Math.round(tp.original          * 100) : null;
  var aProb = tp.adjusted          != null ? Math.round(tp.adjusted          * 100) : null;
  var oProb = tp.adjustedOptimized != null ? Math.round(tp.adjustedOptimized * 100) : null;

  var labels = [], data = [], colors = [];
  if (bProb != null) { labels.push('Baseline');          data.push(bProb); colors.push('#94A3B8'); }
  if (aProb != null) { labels.push('Your Settings');     data.push(aProb); colors.push('#60A5FA'); }
  if (oProb != null) { labels.push('SACO Optimized');    data.push(oProb); colors.push('#3B82F6'); }
  if (!data.length) return null;

  var cfg = {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{ label: 'P(≤ Target)', data: data, backgroundColor: colors }]
    },
    options: {
      plugins: { title: { display: true, text: 'Probability of Meeting Target' } },
      scales:  { y: { min: 0, max: 100, title: { display: true, text: '%' } } }
    }
  };
  return 'https://quickchart.io/chart?width=500&height=300&c=' + encodeURIComponent(JSON.stringify(cfg));
}

// Build SACO report URL encoding all tasks + session token.
// results: array parallel to tasks (may be shorter if some failed).
// tasks:   original task input array.
// token:   session token for plot-link back-navigation.
function buildSacoReportUrl(results, tasks, token) {
  try {
    var taskSeeds = tasks.map(function(task, i) {
      var res = (results && results[i]) ? results[i] : null;
      var tp  = (res && res.targetProbability && res.targetProbability.value) || {};
      var cdf = (res && res.baseline && res.baseline.monteCarloSmoothed && res.baseline.monteCarloSmoothed.cdfPoints) || [];
      return {
        task:          task.task,
        O:             task.optimistic,
        M:             task.mostLikely,
        P:             task.pessimistic,
        target:        task.targetValue || null,
        baselineProb:  tp.original          != null ? tp.original          : null,
        adjustedProb:  tp.adjusted          != null ? tp.adjusted          : null,
        optimizedProb: tp.adjustedOptimized != null ? tp.adjustedOptimized : null,
        p10: cdf.length ? invertCdf(cdf, 0.10) : null,
        p50: cdf.length ? invertCdf(cdf, 0.50) : null,
        p90: cdf.length ? invertCdf(cdf, 0.90) : null
      };
    });
    var payload = { schemaVersion: 1, session: token || null, tasks: taskSeeds };
    var encoded = encodeURIComponent(Utilities.base64Encode(JSON.stringify(payload)));
    return 'https://abeljstephen.github.io/projectcare/saco/report/?data=' + encoded + (token ? '&session=' + token : '');
  } catch(e) {
    return null;
  }
}


// Builds the SACO GitHub Pages plot URL.
// slimTasks: already-built slim scalar array (one object per task, no arrays).
// tasks: original task input array (unused here, kept for signature clarity).
function buildSacoPlotUrl(slimTasks, tasks, token, portfolio) {
  try {
    var slim = {
      schemaVersion: 1,
      tasks:     slimTasks,
      portfolio: portfolio || null
    };
    var encoded = encodeURIComponent(Utilities.base64Encode(JSON.stringify(slim)));
    return 'https://abeljstephen.github.io/projectcare/saco/plot/?data=' + encoded + '&session=' + token;
  } catch (e) {
    return 'https://abeljstephen.github.io/projectcare/saco/plot/?session=' + token;
  }
}

function buildCpmUrl(tasks, token) {
  try {
    // CPM seed: task name, O/M/P, predecessors (minimal payload)
    var seed = {
      schemaVersion: 1,
      tasks: tasks.map(function(t) {
        return {
          id:           String(t.id || t.task),
          task:         t.task,
          O:            t.optimistic,
          M:            t.mostLikely,
          P:            t.pessimistic,
          predecessors: t.predecessors || []
        };
      })
    };
    var encoded = encodeURIComponent(Utilities.base64Encode(JSON.stringify(seed)));
    return 'https://abeljstephen.github.io/projectcare/cpm/plot/?data=' + encoded + '&session=' + token;
  } catch (e) {
    return 'https://abeljstephen.github.io/projectcare/cpm/plot/?session=' + token;
  }
}

// ── QUOTA BAR BUILDER ─────────────────────────────────────────────────────────
function buildBar(used, total) {
  if (!total) return '░░░░░░░░░░░░░░░░░░░░  0% remaining';
  var pct    = Math.min(100, Math.round((used / total) * 100));
  var filled = Math.round(pct / 5);
  return '█'.repeat(filled) + '░'.repeat(20 - filled)
    + '  ' + (100 - pct) + '% remaining  (' + (total - used) + ' / ' + total + ' credits)';
}

// ── SENSITIVITY BLOCK (synchronous finite-difference) ────────────────────────
// Computes dP/dSlider for each of the 7 sliders using a forward finite-difference.
// Uses computeSliderProbability() from global GAS scope (slider-adjustments.gs).
// sliderValues expected in UI units (0–100; reworkPercentage 0–50).
// Step = 10 for most sliders; step = 5 for reworkPercentage.
// Returns { baselineProbability, sliders: [{slider, gain, direction}, ...] } sorted by |gain|.
function computeSensitivityBlock(task, basePoints) {
  var sliders = task.sliderValues && typeof task.sliderValues === 'object'
    ? task.sliderValues : {};
  // Neutral defaults when no sliders provided
  var base = {
    budgetFlexibility:       sliders.budgetFlexibility       != null ? sliders.budgetFlexibility       : 50,
    scheduleFlexibility:     sliders.scheduleFlexibility     != null ? sliders.scheduleFlexibility     : 50,
    scopeCertainty:          sliders.scopeCertainty          != null ? sliders.scopeCertainty          : 50,
    scopeReductionAllowance: sliders.scopeReductionAllowance != null ? sliders.scopeReductionAllowance : 50,
    reworkPercentage:        sliders.reworkPercentage        != null ? sliders.reworkPercentage        : 25,
    riskTolerance:           sliders.riskTolerance           != null ? sliders.riskTolerance           : 50,
    userConfidence:          sliders.userConfidence          != null ? sliders.userConfidence          : 75
  };

  var baseRes = computeSliderProbability({
    points: basePoints,
    optimistic:  Number(task.optimistic),
    mostLikely:  Number(task.mostLikely),
    pessimistic: Number(task.pessimistic),
    targetValue: Number(task.targetValue),
    sliderValues: base,
    probeLevel: 1
  });
  var baseProb = (baseRes.probability && Number.isFinite(baseRes.probability.value))
    ? baseRes.probability.value : null;
  if (baseProb === null) return null;

  var KEYS = ['budgetFlexibility','scheduleFlexibility','scopeCertainty',
              'scopeReductionAllowance','reworkPercentage','riskTolerance','userConfidence'];
  var MAX_VAL = { reworkPercentage: 50 };   // all others 100
  var STEP    = { reworkPercentage:  5 };   // all others 10

  var entries = [];
  for (var ki = 0; ki < KEYS.length; ki++) {
    var k        = KEYS[ki];
    var maxV     = MAX_VAL[k] || 100;
    var h        = STEP[k]    || 10;
    var cur      = base[k];
    var right    = Math.min(maxV, cur + h);
    var left     = Math.max(0,    cur - h);
    var useRight = right > cur;
    var pertVal  = useRight ? right : left;
    var actualH  = useRight ? (right - cur) : (cur - left);
    if (actualH <= 0) { entries.push({ slider: k, gain: 0, direction: 'neutral' }); continue; }

    var pert = {};
    for (var pk in base) { if (Object.prototype.hasOwnProperty.call(base, pk)) pert[pk] = base[pk]; }
    pert[k] = pertVal;

    var pRes = computeSliderProbability({
      points: basePoints,
      optimistic:  Number(task.optimistic),
      mostLikely:  Number(task.mostLikely),
      pessimistic: Number(task.pessimistic),
      targetValue: Number(task.targetValue),
      sliderValues: pert,
      probeLevel: 1
    });
    var pProb = (pRes.probability && Number.isFinite(pRes.probability.value))
      ? pRes.probability.value : null;
    if (pProb === null) { entries.push({ slider: k, gain: 0, direction: 'neutral' }); continue; }

    // Forward: (P(s+h)−P(s))/h  |  Backward: (P(s)−P(s−h))/h
    var dPdS = useRight
      ? (pProb - baseProb) / actualH
      : (baseProb - pProb) / actualH;
    entries.push({
      slider:    k,
      gain:      Math.round(dPdS * 1e6) / 1e6,
      direction: dPdS > 1e-6 ? 'positive' : dPdS < -1e-6 ? 'negative' : 'neutral'
    });
  }

  entries.sort(function(a, b) { return Math.abs(b.gain) - Math.abs(a.gain); });
  return { baselineProbability: Math.round(baseProb * 10000) / 10000, sliders: entries };
}

// ── SCENARIO BATCH ────────────────────────────────────────────────────────────
// Evaluates alternative scenarios for a single task.
// Slider-change scenarios: computeSliderProbability with modified sliders (±targetValue).
// Target-only scenarios: interpolateCdf on baseline CDF.
// Returns array of { name, targetValue, probability } or { name, error }.
function computeScenarioBatch(task, basePoints) {
  var baseSliders = task.sliderValues && typeof task.sliderValues === 'object'
    ? task.sliderValues : {};
  var scenarios = task.scenarios;
  var results = [];

  for (var si = 0; si < scenarios.length; si++) {
    var scn = scenarios[si];
    try {
      var scTarget  = scn.targetValue  != null ? Number(scn.targetValue)
                    : task.targetValue != null ? Number(task.targetValue) : null;
      var scSliders = scn.sliderValues != null ? scn.sliderValues : baseSliders;

      if (scn.sliderValues != null) {
        // Slider scenario — compute reshaped probability at target
        if (scTarget === null) {
          results.push({ name: scn.name, note: 'No targetValue — cannot express as probability' });
          continue;
        }
        var sRes = computeSliderProbability({
          points: basePoints,
          optimistic:  Number(task.optimistic),
          mostLikely:  Number(task.mostLikely),
          pessimistic: Number(task.pessimistic),
          targetValue: scTarget,
          sliderValues: scSliders,
          probeLevel: 1
        });
        var sProb = (sRes.probability && Number.isFinite(sRes.probability.value))
          ? Math.round(sRes.probability.value * 10000) / 10000 : null;
        results.push({ name: scn.name, targetValue: scTarget, probability: sProb });

      } else if (scn.targetValue != null) {
        // Target-only scenario — use baseline CDF (no slider change)
        var tVal  = interpolateCdf(basePoints.cdfPoints, Number(scn.targetValue));
        var tProb = (tVal && Number.isFinite(tVal.value))
          ? Math.round(tVal.value * 10000) / 10000 : null;
        results.push({ name: scn.name, targetValue: Number(scn.targetValue), probability: tProb });
      }
    } catch (e) {
      results.push({ name: scn.name, error: 'Scenario computation failed' });
    }
  }
  return results;
}

// ── SESSION HANDLERS ──────────────────────────────────────────────────────────
function handleSaveSession(body) {
  var key   = (body.key   || '').trim();
  var email = (body.email || '').trim().toLowerCase();
  var session = body.session;

  if (!key) return jsonOut({ error: 'API key is required' });
  var emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  if (!email || !emailPattern.test(email))
    return jsonOut({ error: 'A valid email address is required' });
  if (!session || typeof session !== 'object')
    return jsonOut({ error: 'session must be a JSON object' });
  var sessionSize;
  try { sessionSize = JSON.stringify(session).length; } catch (e) { sessionSize = 0; }
  if (sessionSize > 50000)
    return jsonOut({ error: 'Session data too large (max 50 KB)' });

  var resp = wpPost('/projectcare/v1/session/save', { key: key, email: email, session: session });
  return jsonOut(resp);
}

function handleLoadSessions(body) {
  var key   = (body.key   || '').trim();
  var email = (body.email || '').trim().toLowerCase();

  if (!key) return jsonOut({ error: 'API key is required' });
  var emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  if (!email || !emailPattern.test(email))
    return jsonOut({ error: 'A valid email address is required' });

  var resp = wpPost('/projectcare/v1/session/load', { key: key, email: email });
  return jsonOut(resp);
}

// ── DAILY EXECUTION COUNTER ───────────────────────────────────────────────────
// Uses PropertiesService to count executions per calendar day (script timezone).
// Resets at midnight. Thread-safe enough for rate-limiting purposes.
function getDailyExecCount() {
  try {
    var props   = PropertiesService.getScriptProperties();
    var tz      = Session.getScriptTimeZone();
    var today   = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    var stored  = props.getProperty('pc_exec_date')  || '';
    var count   = parseInt(props.getProperty('pc_exec_count') || '0', 10);
    if (stored !== today) {
      count = 1;
      props.setProperties({ pc_exec_date: today, pc_exec_count: '1' });
    } else {
      count += 1;
      props.setProperty('pc_exec_count', String(count));
    }
    return count;
  } catch (e) {
    return 0;
  }
}

// ── BENCHMARK HANDLER ─────────────────────────────────────────────────────────
// Times GAS compute overhead for slim (PERT) and a WP round-trip.
// Called by the ProjectCare CRM → GAS Status → Benchmark button.
// No auth required — only returns timing data, no user data exposed.
function handleBenchmark(body) {
  try {
    // Time PERT math on 5 synthetic tasks (mirrors slim tier compute)
    var syntheticTasks = [
      { optimistic:10, mostLikely:15, pessimistic:25 },
      { optimistic:5,  mostLikely:8,  pessimistic:14 },
      { optimistic:20, mostLikely:30, pessimistic:50 },
      { optimistic:3,  mostLikely:5,  pessimistic:8  },
      { optimistic:12, mostLikely:18, pessimistic:28 },
    ];
    var slimStart = Date.now();
    for (var i = 0; i < syntheticTasks.length; i++) {
      _pertStats(syntheticTasks[i]);
    }
    var slimComputeMs = Date.now() - slimStart;

    // Time a WP round-trip (ping action — no DB load)
    var pingStart = Date.now();
    wpPost('/projectcare/v1/quota', { key: '__benchmark__' });
    var wpRoundtripMs = Date.now() - pingStart;

    return jsonOut({
      ok:               true,
      slim_compute_ms:  slimComputeMs,
      wp_roundtrip_ms:  wpRoundtripMs,
      daily_exec_count: getDailyExecCount(),
      ts:               new Date().toISOString()
    });
  } catch (err) {
    return jsonOut({ ok: false, error: err.message });
  }
}

// ── PING HANDLER ──────────────────────────────────────────────────────────────
// Lightweight health check — returns version, timestamp, and daily exec count.
// Called by WordPress Tools → Ping GAS button.
function handlePing(body) {
  try {
    var props  = PropertiesService.getScriptProperties();
    var tz     = Session.getScriptTimeZone();
    var today  = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    var stored = props.getProperty('pc_exec_date') || '';
    var count  = stored === today
      ? parseInt(props.getProperty('pc_exec_count') || '0', 10)
      : 0;
    return jsonOut({
      ok:               true,
      version:          60,
      ts:               new Date().toISOString(),
      daily_exec_count: count,
      exec_date:        today
    });
  } catch (e) {
    return jsonOut({ ok: false, error: e.message });
  }
}

// ── JSON RESPONSE HELPER ──────────────────────────────────────────────────────
function jsonOut(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
