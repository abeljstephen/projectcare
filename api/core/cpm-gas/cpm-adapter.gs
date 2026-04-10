// cpm/cpm-adapter.gs — Schedule Health Score and unified CP engine entry point
// Project Advisor — CP Engine v1.0
// Pure GAS global scope. No Node.js.
// Depends on: cpm/graph.gs, cpm/cpm-engine.gs, cpm/stochastic-cpm.gs

// ─────────────────────────────────────────────
// Schedule Health Score (0–100, grade A–F)
// Inputs: deterministic CPM result, optional stochastic CPM result
// ─────────────────────────────────────────────
function cpmScheduleHealthScore(detCPM, stochCPM) {
  if (!detCPM || detCPM.status !== 'ok') {
    return { score: null, grade: 'N/A', factors: {} };
  }

  var taskIds  = Object.keys(detCPM.tasks);
  var n        = taskIds.length;
  var projDur  = detCPM.projectDuration;

  // Factor 1 (weight 0.30): fraction of tasks on or near-critical (float < 10% of project duration)
  var nearCritCount = taskIds.filter(function(id) {
    return detCPM.tasks[id].totalFloat < 0.10 * projDur;
  }).length;
  var NCP = n > 0 ? nearCritCount / n : 0;

  // Factor 2 (weight 0.20): convergence density (convergence nodes / total nodes)
  var CD = n > 0 ? detCPM.graphMetrics.convergenceCount / n : 0;

  // Factor 3 (weight 0.15): graph density
  var GD = detCPM.graphMetrics.density;

  // Factor 4 (weight 0.15): criticality index uniformity (from stochastic)
  // Low spread = most tasks have similar criticality = high schedule risk
  var CIS = 0;
  if (stochCPM && stochCPM.status === 'ok') {
    var ciVals = Object.values(stochCPM.criticalityIndex);
    if (ciVals.length > 1) {
      var ciMean = ciVals.reduce(function(s, v) { return s + v; }, 0) / ciVals.length;
      var ciVar  = ciVals.reduce(function(s, v) { return s + (v - ciMean) * (v - ciMean); }, 0) / ciVals.length;
      var ciStd  = Math.sqrt(ciVar);
      // ciStd near 0.5 = healthy spread; ciStd near 0 = all tasks equally critical (risky)
      CIS = Math.max(0, 1 - ciStd / 0.5);
    }
  }

  // Factor 5 (weight 0.20): negative float penalty (project already behind)
  var hasNegativeFloat = taskIds.some(function(id) {
    return detCPM.tasks[id].totalFloat < -0.0001;
  });
  var NEG = hasNegativeFloat ? 1.0 : 0.0;

  // Composite risk score (higher raw = worse schedule health)
  var raw   = 0.30 * NCP + 0.20 * CD + 0.15 * GD + 0.15 * CIS + 0.20 * NEG;
  var score = Math.max(0, Math.min(100, Math.round((1 - raw) * 100)));
  var grade = score >= 80 ? 'A'
            : score >= 65 ? 'B'
            : score >= 50 ? 'C'
            : score >= 35 ? 'D'
            : 'F';

  return {
    score: score,
    grade: grade,
    interpretation: _cpmHealthInterpretation(score),
    factors: {
      nearCriticalFraction: _r4(NCP),
      convergenceDensity:   _r4(CD),
      graphDensity:         _r4(GD),
      criticalitySpread:    _r4(CIS),
      hasNegativeFloat:     hasNegativeFloat
    }
  };
}

function _cpmHealthInterpretation(score) {
  if (score >= 80) return 'Low schedule risk. Most tasks have healthy float and few convergence points.';
  if (score >= 65) return 'Moderate schedule risk. Some near-critical tasks warrant monitoring.';
  if (score >= 50) return 'Elevated schedule risk. Multiple near-critical paths or convergence points detected.';
  if (score >= 35) return 'High schedule risk. Critical path dominates the network with limited float protection.';
  return 'Very high schedule risk. Near-zero float across most tasks or negative float detected.';
}

// ─────────────────────────────────────────────
// Main CP engine entry point
// Called from projectcareAPI after SACO task loop.
// tasks:         original task input array
// sacoResults:   parallel array of SACO results (may be null for CP-only mode)
// options:       { cpmPercentile, stochastic, stochasticN, nearCriticalThreshold }
// sliderContext: project-level slider values (drives task-task correlation m_slider)
// ─────────────────────────────────────────────
function runCPEngine(tasks, sacoResults, options, sliderContext) {
  options = options || {};

  try {
    // 1. Deterministic CPM
    var detResult = runDeterministicCPM(tasks, sacoResults, {
      cpmPercentile:         options.cpmPercentile         || 0.80,
      nearCriticalThreshold: options.nearCriticalThreshold || 0.10
    });

    if (detResult.status === 'error') {
      return {
        status:        'error',
        deterministic:  detResult,
        stochastic:     null,
        healthScore:    null
      };
    }

    // 2. Stochastic CPM (default: on; disable via options.stochastic = false)
    //    Pass detResult for graph distances/merge ancestors and sliderContext for m_slider.
    var stochResult = null;
    if (options.stochastic !== false) {
      try {
        // Reuse the graph and order already computed inside detResult
        var graph = detResult._graph || cpmBuildGraph(tasks);
        var order = detResult.topologicalOrder;
        if (order && order.length > 0) {
          stochResult = runStochasticCPM(
            tasks, sacoResults, graph, order,
            {
              n:                    options.stochasticN        || CPM_STOCHASTIC_DEFAULT_N,
              nearCriticalThreshold: options.nearCriticalThreshold || 0.10
            },
            detResult,
            sliderContext || null
          );
        }
      } catch (se) {
        stochResult = {
          status:  'error',
          message: (se && se.message) ? se.message : 'Stochastic CPM failed'
        };
      }
    }

    // 3. Schedule health score
    var healthScore = cpmScheduleHealthScore(detResult, stochResult);

    // Strip internal _graph/_graphDistances/_mergeAncestors before returning to caller
    var detPublic = {};
    Object.keys(detResult).forEach(function(k) {
      if (k !== '_graph' && k !== '_graphDistances' && k !== '_mergeAncestors') {
        detPublic[k] = detResult[k];
      }
    });

    return {
      status:        'ok',
      deterministic:  detPublic,
      stochastic:     stochResult,
      healthScore:    healthScore
    };

  } catch (e) {
    return {
      status:        'error',
      message:       (e && e.message) ? e.message : 'CP engine failed',
      deterministic:  null,
      stochastic:     null,
      healthScore:    null
    };
  }
}
