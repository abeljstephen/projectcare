// Ported from system-google-sheets-addon/core/cpm/cpm-engine.gs
// cpm/cpm-engine.gs — Deterministic CPM: forward/backward passes, floats, tipping points
// Project Advisor — CP Engine v1.0
// Pure GAS global scope. No Node.js.
// Depends on: cpm/graph.gs, helpers/metrics.gs (invertCdf)

// ─────────────────────────────────────────────
// Duration extraction from SACO result
// ─────────────────────────────────────────────

/**
 * Extract a single CPM duration from a SACO result at the given percentile.
 * Fallback chain: optimized CDF → baseline CDF → PERT mean → raw duration field.
 */
function cpmExtractDuration(sacoResult, task, percentile) {
  // 1. Try SACO optimized CDF
  var optCdf = sacoResult &&
    sacoResult.optimize &&
    sacoResult.optimize.reshapedPoints &&
    Array.isArray(sacoResult.optimize.reshapedPoints.cdfPoints) &&
    sacoResult.optimize.reshapedPoints.cdfPoints.length > 0
      ? sacoResult.optimize.reshapedPoints.cdfPoints
      : null;

  if (optCdf) {
    var inv = invertCdf(optCdf, percentile);
    if (Number.isFinite(inv) && inv > 0) return inv;
  }

  // 2. Try SACO baseline CDF
  var baseCdf = sacoResult &&
    sacoResult.baseline &&
    sacoResult.baseline.monteCarloSmoothed &&
    Array.isArray(sacoResult.baseline.monteCarloSmoothed.cdfPoints) &&
    sacoResult.baseline.monteCarloSmoothed.cdfPoints.length > 0
      ? sacoResult.baseline.monteCarloSmoothed.cdfPoints
      : null;

  if (baseCdf) {
    var inv2 = invertCdf(baseCdf, percentile);
    if (Number.isFinite(inv2) && inv2 > 0) return inv2;
  }

  // 3. PERT mean
  if (task && Number.isFinite(task.optimistic) && Number.isFinite(task.mostLikely) && Number.isFinite(task.pessimistic)) {
    return (task.optimistic + 4 * task.mostLikely + task.pessimistic) / 6;
  }

  // 4. Raw duration field (CP-only mode, no SACO)
  if (Number.isFinite(Number(task.duration))) return Number(task.duration);

  return 0;
}

// ─────────────────────────────────────────────
// Forward pass
// Computes EarlyStart and EarlyFinish for each task.
// Handles FS, SS, FF, SF with lag/lead.
// ─────────────────────────────────────────────
function cpmForwardPass(graph, durations, order) {
  var es = {};
  var ef = {};

  order.forEach(function(id) {
    var dur   = durations[id] || 0;
    var preds = graph.reverseAdj[id] || [];

    if (preds.length === 0) {
      es[id] = 0;
    } else {
      var maxES = 0;

      preds.forEach(function(pred) {
        var fromId = pred.from;
        var type   = pred.type || 'FS';
        var lag    = Number.isFinite(pred.lag) ? pred.lag : 0;
        var fromEF = ef[fromId] !== undefined ? ef[fromId] : 0;
        var fromES = es[fromId] !== undefined ? es[fromId] : 0;
        var constraint;

        if      (type === 'FS') constraint = fromEF + lag;          // successor starts after predecessor finishes
        else if (type === 'SS') constraint = fromES + lag;          // successor starts when predecessor starts
        else if (type === 'FF') constraint = fromEF + lag - dur;    // successor finishes when predecessor finishes
        else if (type === 'SF') constraint = fromES + lag - dur;    // successor finishes when predecessor starts
        else                    constraint = fromEF + lag;          // default FS

        maxES = Math.max(maxES, constraint);
      });

      es[id] = Math.max(0, maxES);
    }

    ef[id] = es[id] + dur;
  });

  var result = {};
  order.forEach(function(id) {
    result[id] = { earlyStart: es[id], earlyFinish: ef[id] };
  });
  return result;
}

// ─────────────────────────────────────────────
// Backward pass
// Computes LateStart and LateFinish for each task.
// Handles FS, SS, FF, SF with lag/lead.
// ─────────────────────────────────────────────
function cpmBackwardPass(graph, durations, order, projectEnd) {
  var ls = {};
  var lf = {};
  var reverseOrder = order.slice().reverse();

  reverseOrder.forEach(function(id) {
    var dur   = durations[id] || 0;
    var succs = graph.adjacency[id] || [];

    if (succs.length === 0) {
      lf[id] = projectEnd;
    } else {
      var minLF = Infinity;

      succs.forEach(function(succ) {
        var toId  = succ.to;
        var type  = succ.type || 'FS';
        var lag   = Number.isFinite(succ.lag) ? succ.lag : 0;
        var toLF  = lf[toId] !== undefined ? lf[toId] : projectEnd;
        var toLS  = ls[toId] !== undefined ? ls[toId] : (projectEnd - (durations[toId] || 0));
        var constraint;

        if      (type === 'FS') constraint = toLS - lag;            // predecessor must finish before successor starts
        else if (type === 'SS') constraint = toLS - lag + dur;      // predecessor starts with successor
        else if (type === 'FF') constraint = toLF - lag;            // predecessor finishes with successor
        else if (type === 'SF') constraint = toLF - lag + dur;      // predecessor starts when successor finishes
        else                    constraint = toLS - lag;            // default FS

        minLF = Math.min(minLF, constraint);
      });

      lf[id] = Number.isFinite(minLF) ? minLF : projectEnd;
    }

    ls[id] = lf[id] - dur;
  });

  var result = {};
  reverseOrder.forEach(function(id) {
    result[id] = { lateStart: ls[id], lateFinish: lf[id] };
  });
  return result;
}

// ─────────────────────────────────────────────
// All 4 float types
// ─────────────────────────────────────────────
function cpmComputeFloats(graph, durations, forward, backward, order) {
  var result = {};

  order.forEach(function(id) {
    var ef  = forward[id].earlyFinish;
    var es  = forward[id].earlyStart;
    var lf  = backward[id].lateFinish;
    var ls  = backward[id].lateStart;
    var dur = durations[id] || 0;

    // Total float: how much task can slip without delaying project end
    var totalFloat = lf - ef;

    // Free float: how much task can slip without delaying its immediate successors
    var succs     = graph.adjacency[id] || [];
    var freeFloat = totalFloat;

    if (succs.length > 0) {
      succs.forEach(function(succ) {
        var toId = succ.to;
        var lag  = Number.isFinite(succ.lag) ? succ.lag : 0;
        var type = succ.type || 'FS';
        var toES = forward[toId] ? forward[toId].earlyStart  : ef;
        var toEF = forward[toId] ? forward[toId].earlyFinish : ef;
        var ff;

        if      (type === 'FS') ff = toES - ef - lag;
        else if (type === 'SS') ff = toES - es - lag;
        else if (type === 'FF') ff = toEF - ef - lag;
        else if (type === 'SF') ff = toEF - es - lag;
        else                    ff = toES - ef - lag;

        freeFloat = Math.min(freeFloat, ff);
      });
    }

    // Interfering float: float that if used delays a successor but not project end
    var interferingFloat = totalFloat - freeFloat;

    // Independent float: float usable regardless of predecessor/successor timing
    var preds      = graph.reverseAdj[id] || [];
    var maxPredLF  = 0;
    preds.forEach(function(pred) {
      var predLF = backward[pred.from] ? backward[pred.from].lateFinish : 0;
      maxPredLF  = Math.max(maxPredLF, predLF);
    });
    var minSuccES = Infinity;
    succs.forEach(function(succ) {
      var toES = forward[succ.to] ? forward[succ.to].earlyStart : Infinity;
      minSuccES = Math.min(minSuccES, toES);
    });
    var independentFloat = succs.length === 0
      ? Math.max(0, freeFloat)
      : Math.max(0, (Number.isFinite(minSuccES) ? minSuccES : lf) - maxPredLF - dur);

    result[id] = {
      totalFloat:        _r4(totalFloat),
      freeFloat:         _r4(freeFloat),
      interferingFloat:  _r4(interferingFloat),
      independentFloat:  _r4(independentFloat),
      onCriticalPath:    Math.abs(totalFloat) < 0.0001
    };
  });

  return result;
}

// ─────────────────────────────────────────────
// Tipping point analysis
// For each non-critical task: float consumption threshold before path goes critical.
// ─────────────────────────────────────────────
function cpmComputeTippingPoints(graph, floats, projectDuration, order) {
  var result = {};

  order.forEach(function(id) {
    if (floats[id].onCriticalPath) {
      result[id] = { tippingPoint: 0, severity: 'CRITICAL', onCriticalPath: true };
      return;
    }

    // Tipping point = how much float this task can absorb before joining the critical path.
    // Total float already encodes the longest-path slack, so tp = totalFloat.
    var tp = Math.max(0, floats[id].totalFloat);
    var threshold10 = 0.10 * projectDuration;
    var threshold25 = 0.25 * projectDuration;
    var severity = tp <= 0 ? 'CRITICAL'
                 : tp < threshold10 ? 'HIGH'
                 : tp < threshold25 ? 'MEDIUM'
                 : 'LOW';

    result[id] = { tippingPoint: _r4(tp), severity: severity, onCriticalPath: false };
  });

  return result;
}

// ─────────────────────────────────────────────
// Graph metrics
// ─────────────────────────────────────────────
function cpmGraphMetrics(graph) {
  var nodes = Object.keys(graph.nodes);
  var n     = nodes.length;
  var e     = graph.edges.length;

  var density = n > 1 ? e / (n * (n - 1)) : 0;

  var inDegree  = {};
  var outDegree = {};
  nodes.forEach(function(id) {
    inDegree[id]  = (graph.reverseAdj[id] || []).length;
    outDegree[id] = (graph.adjacency[id]  || []).length;
  });

  var maxInDegree  = n > 0 ? Math.max.apply(null, nodes.map(function(id) { return inDegree[id];  })) : 0;
  var maxOutDegree = n > 0 ? Math.max.apply(null, nodes.map(function(id) { return outDegree[id]; })) : 0;

  var convergenceNodes = nodes.filter(function(id) { return inDegree[id] > 1; });

  return {
    nodeCount:        n,
    edgeCount:        e,
    density:          _r4(density),
    maxInDegree:      maxInDegree,
    maxOutDegree:     maxOutDegree,
    convergenceNodes: convergenceNodes,
    convergenceCount: convergenceNodes.length
  };
}

// ─────────────────────────────────────────────
// Main deterministic CPM runner
// ─────────────────────────────────────────────
function runDeterministicCPM(tasks, sacoResults, options) {
  options = options || {};
  var percentile            = Number.isFinite(options.cpmPercentile)         ? options.cpmPercentile         : 0.80;
  var nearCritThreshold     = Number.isFinite(options.nearCriticalThreshold) ? options.nearCriticalThreshold : 0.10;

  // 1. Build graph
  var graph = cpmBuildGraph(tasks);

  // 2. Validate inputs
  var validation = cpmValidateGraph(tasks, graph);

  // 3. Detect ALL cycles (Tarjan)
  var cycles = cpmDetectCycles(graph);
  if (cycles.length > 0) {
    return {
      status:            'error',
      code:              'CYCLES_DETECTED',
      cycles:            cycles,
      cycleDescriptions: cycles.map(function(c) { return 'Cycle: ' + c.join(' → ') + ' → ' + c[0]; }),
      message:           'Network contains ' + cycles.length + ' cycle(s). Fix these dependencies before running CPM.',
      validationErrors:  validation.errors
    };
  }

  // 4. Topological sort (Kahn's)
  var topo = cpmTopologicalSort(graph);
  if (!topo.success) {
    return { status: 'error', code: 'TOPO_SORT_FAILED', message: 'Topological sort failed. Possible cycle not caught by Tarjan.' };
  }
  var order = topo.order;

  // 5. Extract durations from SACO results
  var durations       = {};
  var durationSources = {};
  tasks.forEach(function(task, idx) {
    var id            = cpmTaskId(task, idx);
    var sr            = sacoResults ? sacoResults[idx] : null;
    durations[id]     = cpmExtractDuration(sr, task, percentile);
    durationSources[id] = (sr && !sr.error) ? ('saco_p' + Math.round(percentile * 100)) : 'pert_mean_or_raw';
  });

  // 6. Detect orphan groups
  var orphans = cpmFindOrphans(graph);

  // 7. Forward pass
  var forward = cpmForwardPass(graph, durations, order);

  // 8. Project duration = max EarlyFinish at sink nodes
  var projectDuration = 0;
  graph.sinks.forEach(function(id) {
    if (forward[id]) projectDuration = Math.max(projectDuration, forward[id].earlyFinish);
  });

  // 9. Backward pass
  var backward = cpmBackwardPass(graph, durations, order, projectDuration);

  // 10. All 4 float types
  var floats = cpmComputeFloats(graph, durations, forward, backward, order);

  // 11. Critical path and near-critical tasks
  var criticalPath     = order.filter(function(id) { return floats[id].onCriticalPath; });
  var nearCriticalTasks = order.filter(function(id) {
    return !floats[id].onCriticalPath && floats[id].totalFloat < nearCritThreshold * projectDuration;
  });

  // 12. Tipping points
  var tipping = cpmComputeTippingPoints(graph, floats, projectDuration, order);

  // 13. Graph metrics
  var graphMetrics = cpmGraphMetrics(graph);

  // 13b. Graph distances and merge ancestors (for stochastic correlation matrix)
  var graphDistances  = cpmAllPairsDistance(graph, order);
  var mergeAncestors  = cpmMergeAncestors(graph, order);

  // 14. Merge point bias warning
  var mergePointBiasWarning = graphMetrics.convergenceCount > 0
    ? 'Merge point bias present at ' + graphMetrics.convergenceCount +
      ' convergence node(s) [' + graphMetrics.convergenceNodes.join(', ') + ']. ' +
      'Deterministic CPM likely underestimates project duration. Stochastic analysis recommended.'
    : null;

  // 15. Assemble per-task output
  var taskResults = {};
  order.forEach(function(id) {
    taskResults[id] = {
      id:               id,
      name:             graph.nodes[id].name,
      duration:         _r4(durations[id]),
      durationSource:   durationSources[id],
      earlyStart:       _r4(forward[id].earlyStart),
      earlyFinish:      _r4(forward[id].earlyFinish),
      lateStart:        _r4(backward[id].lateStart),
      lateFinish:       _r4(backward[id].lateFinish),
      totalFloat:       floats[id].totalFloat,
      freeFloat:        floats[id].freeFloat,
      interferingFloat: floats[id].interferingFloat,
      independentFloat: floats[id].independentFloat,
      onCriticalPath:   floats[id].onCriticalPath,
      tippingPoint:     tipping[id].tippingPoint,
      tippingSeverity:  tipping[id].severity
    };
  });

  return {
    status:                 'ok',
    projectDuration:        _r4(projectDuration),
    cpmPercentile:          percentile,
    criticalPath:           criticalPath,
    nearCriticalTasks:      nearCriticalTasks,
    tasks:                  taskResults,
    graphMetrics:           graphMetrics,
    orphanGroups:           orphans,
    validationErrors:       validation.errors,
    mergePointBiasWarning:  mergePointBiasWarning,
    sources:                graph.sources,
    sinks:                  graph.sinks,
    topologicalOrder:       order,
    // Internal data for stochastic correlation matrix — not sent to client
    _graphDistances:        graphDistances,
    _mergeAncestors:        mergeAncestors,
    _graph:                 graph
  };
}

// ─────────────────────────────────────────────
// Utility: round to 4 decimal places
// ─────────────────────────────────────────────
function _r4(v) {
  return Math.round(v * 10000) / 10000;
}
