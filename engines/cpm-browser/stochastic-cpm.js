// Ported from system-google-sheets-addon/core/cpm/stochastic-cpm.gs
// cpm/stochastic-cpm.gs — Monte Carlo stochastic CPM using SACO distributions
// Project Advisor — CP Engine v1.0
// Pure GAS global scope. No Node.js.
// Depends on: cpm/graph.gs, cpm/cpm-engine.gs, helpers/metrics.gs (invertCdf)

var CPM_STOCHASTIC_DEFAULT_N = 500;
var CPM_STOCHASTIC_MAX_N     = 1000;

// ─────────────────────────────────────────────
// Rational approximation to the normal quantile (probit)
// Used when no SACO CDF is available — lets PERT fallback produce real variance.
// Accuracy: |error| < 4.5e-4 for p ∈ (0,1)  [Abramowitz & Stegun 26.2.23]
// ─────────────────────────────────────────────
function _cpmProbit(p) {
  if (p <= 0) return -8;
  if (p >= 1) return  8;
  var c = [2.515517, 0.802853, 0.010328];
  var d = [1.432788, 0.189269, 0.001308];
  function _rat(t) {
    return t - (c[0] + c[1]*t + c[2]*t*t) / (1 + d[0]*t + d[1]*t*t + d[2]*t*t*t);
  }
  if (p < 0.5) return -_rat(Math.sqrt(-2 * Math.log(p)));
  return _rat(Math.sqrt(-2 * Math.log(1 - p)));
}

// ─────────────────────────────────────────────
// Sample a single duration from a task's SACO CDF
// via probability integral transform: u ~ U(0,1) → invertCdf(cdf, u)
// ─────────────────────────────────────────────
function cpmSampleDuration(sacoResult, task, u) {
  // 1. Try optimized CDF
  var optCdf = sacoResult &&
    sacoResult.optimize &&
    sacoResult.optimize.reshapedPoints &&
    Array.isArray(sacoResult.optimize.reshapedPoints.cdfPoints) &&
    sacoResult.optimize.reshapedPoints.cdfPoints.length > 0
      ? sacoResult.optimize.reshapedPoints.cdfPoints : null;

  if (optCdf) {
    var inv = invertCdf(optCdf, u);
    if (inv && Number.isFinite(inv.value)) return Math.max(0, inv.value);
  }

  // 2. Try baseline CDF
  var baseCdf = sacoResult &&
    sacoResult.baseline &&
    sacoResult.baseline.monteCarloSmoothed &&
    Array.isArray(sacoResult.baseline.monteCarloSmoothed.cdfPoints) &&
    sacoResult.baseline.monteCarloSmoothed.cdfPoints.length > 0
      ? sacoResult.baseline.monteCarloSmoothed.cdfPoints : null;

  if (baseCdf) {
    var inv2 = invertCdf(baseCdf, u);
    if (inv2 && Number.isFinite(inv2.value)) return Math.max(0, inv2.value);
  }

  // 3. PERT normal approximation — samples with variance using probit(u)
  //    μ = (O + 4M + P) / 6,  σ = (P - O) / 6  (PERT standard deviation)
  //    result clamped to [O, P] so samples stay within the stated range
  if (task && Number.isFinite(task.optimistic) && Number.isFinite(task.mostLikely) && Number.isFinite(task.pessimistic)) {
    var mu    = (task.optimistic + 4 * task.mostLikely + task.pessimistic) / 6;
    var sigma = (task.pessimistic - task.optimistic) / 6;
    if (sigma < 1e-9) return mu;
    var s = mu + sigma * _cpmProbit(u);
    return Math.max(task.optimistic, Math.min(task.pessimistic, s));
  }

  return Number.isFinite(Number(task.duration)) ? Number(task.duration) : 0;
}

// ─────────────────────────────────────────────
// PERT sigma for a task (used in SSI computation)
// ─────────────────────────────────────────────
function _cpmTaskSigma(task) {
  if (task && Number.isFinite(task.optimistic) && Number.isFinite(task.pessimistic)) {
    return (task.pessimistic - task.optimistic) / 6;
  }
  return 0;
}

// ─────────────────────────────────────────────
// Stochastic CPM main runner
// ─────────────────────────────────────────────
function runStochasticCPM(tasks, sacoResults, graph, order, options) {
  options = options || {};
  var n = Math.min(
    CPM_STOCHASTIC_MAX_N,
    Math.max(1, Math.round(options.n || CPM_STOCHASTIC_DEFAULT_N))
  );

  // Build stable task ID list in task-array order
  var taskIds = tasks.map(function(task, idx) { return cpmTaskId(task, idx); });

  // Accumulator: how many iterations each task was on the critical path
  var criticalityCount = {};
  order.forEach(function(id) { criticalityCount[id] = 0; });

  // Project duration per iteration (for S-curve and statistics)
  var projectDurations = [];

  // Accumulate mean EarlyFinish at convergence nodes (for merge bias)
  var convergenceNodes = order.filter(function(id) {
    return (graph.reverseAdj[id] || []).length > 1;
  });
  var convergenceEFSum = {};
  convergenceNodes.forEach(function(id) { convergenceEFSum[id] = 0; });

  // ── Monte Carlo loop ──
  for (var iter = 0; iter < n; iter++) {
    // Sample durations (independent across tasks for v1)
    var durations = {};
    tasks.forEach(function(task, idx) {
      var id        = taskIds[idx];
      var sr        = sacoResults ? sacoResults[idx] : null;
      durations[id] = cpmSampleDuration(sr, task, Math.random());
    });

    // Forward pass
    var forward = cpmForwardPass(graph, durations, order);

    // Project duration = max EarlyFinish at sinks
    var projDur = 0;
    graph.sinks.forEach(function(id) {
      if (forward[id]) projDur = Math.max(projDur, forward[id].earlyFinish);
    });
    projectDurations.push(projDur);

    // Backward pass + float + critical path for this iteration
    var backward = cpmBackwardPass(graph, durations, order, projDur);
    var floats   = cpmComputeFloats(graph, durations, forward, backward, order);

    order.forEach(function(id) {
      if (floats[id].onCriticalPath) criticalityCount[id]++;
    });

    // Accumulate convergence node EarlyFinish
    convergenceNodes.forEach(function(id) {
      if (forward[id]) convergenceEFSum[id] += forward[id].earlyFinish;
    });
  }

  // ── Post-processing ──

  // Sort project durations for percentile extraction and S-curve
  projectDurations.sort(function(a, b) { return a - b; });

  var meanDur = projectDurations.reduce(function(s, v) { return s + v; }, 0) / n;
  var varDur  = projectDurations.reduce(function(s, v) { return s + (v - meanDur) * (v - meanDur); }, 0) / n;
  var sigDur  = Math.sqrt(varDur);

  function pctIdx(p) { return Math.min(n - 1, Math.floor(n * p)); }

  // Criticality index per task
  var criticalityIndex = {};
  order.forEach(function(id) {
    criticalityIndex[id] = _r4(criticalityCount[id] / n);
  });

  // Schedule Sensitivity Index (SSI) per task
  // SSI_i = criticalityIndex_i × (σ_task_i / σ_project)
  var ssi = {};
  order.forEach(function(id) {
    var taskIdx   = taskIds.indexOf(id);
    var taskSigma = taskIdx >= 0 ? _cpmTaskSigma(tasks[taskIdx]) : 0;
    ssi[id] = sigDur > 0 ? _r4(criticalityIndex[id] * (taskSigma / sigDur)) : 0;
  });

  // Tornado chart: tasks sorted by SSI descending
  var tornado = order.slice()
    .sort(function(a, b) { return ssi[b] - ssi[a]; })
    .map(function(id) {
      return {
        id:              id,
        name:            graph.nodes[id] ? graph.nodes[id].name : id,
        ssi:             ssi[id],
        criticalityIndex: criticalityIndex[id]
      };
    });

  // S-curve: 25 equally-spaced points from min to max project duration
  var minDur = projectDurations[0];
  var maxDur = projectDurations[n - 1];
  var sCurve = [];
  for (var i = 0; i <= 24; i++) {
    var d     = minDur + (maxDur - minDur) * (i / 24);
    var count = 0;
    projectDurations.forEach(function(v) { if (v <= d) count++; });
    sCurve.push({ x: _r4(d), y: _r4(count / n) });
  }

  // Merge point bias: mean stochastic EarlyFinish at each convergence node
  // (quantifies how much later the stochastic schedule is at each merge point)
  var mergePointBias = {};
  convergenceNodes.forEach(function(id) {
    mergePointBias[id] = _r4(convergenceEFSum[id] / n);
  });

  return {
    status:      'ok',
    iterations:  n,
    projectDuration: {
      mean:  _r4(meanDur),
      p50:   _r4(projectDurations[pctIdx(0.50)]),
      p80:   _r4(projectDurations[pctIdx(0.80)]),
      p90:   _r4(projectDurations[pctIdx(0.90)]),
      sigma: _r4(sigDur),
      min:   _r4(minDur),
      max:   _r4(maxDur)
    },
    sCurve:           sCurve,
    criticalityIndex: criticalityIndex,
    ssi:              ssi,
    tornado:          tornado,
    mergePointBias:   mergePointBias
  };
}
