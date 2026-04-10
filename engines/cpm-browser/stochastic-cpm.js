// Ported from system-google-sheets-addon/core/cpm/stochastic-cpm.gs
// cpm/stochastic-cpm.js — Monte Carlo stochastic CPM with Gaussian copula task correlation
// ProjectCare CP Engine v2.0
// Pure browser global scope. No Node.js.
// Depends on: cpm/graph.js (cpmAllPairsDistance, cpmMergeAncestors),
//             cpm/cpm-engine.js, helpers/metrics.js (invertCdf)

var CPM_STOCHASTIC_DEFAULT_N = 5000;
var CPM_STOCHASTIC_MAX_N     = 10000;
var CPM_CORR_RHO_MIN         = 0.05;
var CPM_CORR_RHO_MAX         = 0.85;

// ─────────────────────────────────────────────
// Rational approximation to the normal quantile (probit)
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
// Error function (Horner's method)
// ─────────────────────────────────────────────
function _cpmErf(x) {
  var t = 1 / (1 + 0.5 * Math.abs(x));
  var tau = t * Math.exp(-x*x - 1.26551223 +
    t*(1.00002368 + t*(0.37409196 + t*(0.09678418 +
    t*(-0.18628806 + t*(0.27886807 + t*(-1.13520398 +
    t*(1.48851587 + t*(-0.82215223 + t*0.17087277)))))))));
  return x >= 0 ? 1 - tau : tau - 1;
}

function _cpmNormalCDF(x) {
  return 0.5 * (1 + _cpmErf(x / 1.4142135623730951));
}

// ─────────────────────────────────────────────
// Jacobi eigendecomposition for small symmetric matrices
// ─────────────────────────────────────────────
function _cpmJacobi(A) {
  var n = A.length;
  var E = A.map(function(row) { return row.slice(); });
  var V = [];
  for (var i = 0; i < n; i++) {
    var row = [];
    for (var j = 0; j < n; j++) row.push(i === j ? 1 : 0);
    V.push(row);
  }

  for (var sweep = 0; sweep < 50 * n; sweep++) {
    var changed = false;
    for (var p = 0; p < n - 1; p++) {
      for (var q = p + 1; q < n; q++) {
        var epq = E[p][q];
        if (Math.abs(epq) < 1e-13) continue;
        changed = true;
        var tau = (E[q][q] - E[p][p]) / (2 * epq);
        var t   = tau >= 0
          ?  1 / ( tau + Math.sqrt(1 + tau * tau))
          : -1 / (-tau + Math.sqrt(1 + tau * tau));
        var c = 1 / Math.sqrt(1 + t * t);
        var s = t * c;
        var Epp = E[p][p], Eqq = E[q][q];
        E[p][p] = Epp - t * epq;
        E[q][q] = Eqq + t * epq;
        E[p][q] = 0;
        E[q][p] = 0;
        for (var r = 0; r < n; r++) {
          if (r !== p && r !== q) {
            var Erp = E[r][p], Erq = E[r][q];
            E[r][p] = E[p][r] = c * Erp - s * Erq;
            E[r][q] = E[q][r] = s * Erp + c * Erq;
          }
          var Vrp = V[r][p], Vrq = V[r][q];
          V[r][p] = c * Vrp - s * Vrq;
          V[r][q] = s * Vrp + c * Vrq;
        }
      }
    }
    if (!changed) break;
  }

  var values = [];
  for (var i = 0; i < n; i++) values.push(E[i][i]);
  return { values: values, vectors: V };
}

function _cpmProjectPSD(A) {
  var n   = A.length;
  var eig = _cpmJacobi(A);
  var R   = [];
  for (var i = 0; i < n; i++) { R.push([]); for (var j = 0; j < n; j++) R[i].push(0); }
  for (var k = 0; k < n; k++) {
    var lam = Math.max(0, eig.values[k]);
    if (lam < 1e-14) continue;
    for (var i = 0; i < n; i++) {
      for (var j = 0; j < n; j++) {
        R[i][j] += lam * eig.vectors[i][k] * eig.vectors[j][k];
      }
    }
  }
  return R;
}

// ─────────────────────────────────────────────
// Higham (2002) nearest correlation matrix via alternating projections
// ─────────────────────────────────────────────
function _cpmHigham(R, maxIter) {
  maxIter = maxIter || 100;
  var n = R.length;

  function sub(A, B) {
    return A.map(function(row, i) { return row.map(function(v, j) { return v - B[i][j]; }); });
  }

  var Y = R.map(function(row) { return row.slice(); });
  var S = [];
  for (var i = 0; i < n; i++) { S.push([]); for (var j = 0; j < n; j++) S[i].push(0); }

  for (var iter = 0; iter < maxIter; iter++) {
    var Yprev = Y.map(function(row) { return row.slice(); });
    var Rk    = sub(Y, S);
    var psd   = _cpmProjectPSD(Rk);
    S = sub(psd, Rk);
    Y = psd.map(function(row, i) {
      return row.map(function(v, j) {
        if (i === j) return 1.0;
        return Math.max(-0.9999, Math.min(0.9999, v));
      });
    });

    var diff = 0;
    for (var i = 0; i < n; i++) {
      for (var j = 0; j < n; j++) {
        var d = Y[i][j] - Yprev[i][j];
        diff += d * d;
      }
    }
    if (diff < 1e-12) break;
  }

  for (var i = 0; i < n; i++) {
    Y[i][i] = 1.0;
    for (var j = i + 1; j < n; j++) {
      var v = (Y[i][j] + Y[j][i]) / 2;
      Y[i][j] = v;
      Y[j][i] = v;
    }
  }
  return Y;
}

// ─────────────────────────────────────────────
// Lower Cholesky: L such that A = LLᵀ (with eps·I safety shift)
// ─────────────────────────────────────────────
function _cpmCholesky(A) {
  var n   = A.length;
  var eps = 1e-9;
  var L   = [];
  for (var i = 0; i < n; i++) { L.push([]); for (var j = 0; j < n; j++) L[i].push(0); }

  for (var i = 0; i < n; i++) {
    for (var j = 0; j <= i; j++) {
      var sum = (i === j ? A[i][j] + eps : A[i][j]);
      for (var k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
      if (i === j) {
        L[i][j] = sum > 0 ? Math.sqrt(sum) : 1e-9;
      } else {
        L[i][j] = L[j][j] > 1e-9 ? sum / L[j][j] : 0;
      }
    }
  }
  return L;
}

// ─────────────────────────────────────────────
// Sample correlated U(0,1)^n from Cholesky factor L
// ─────────────────────────────────────────────
function _cpmSampleCorrelatedU(L) {
  var n  = L.length;
  var z  = [];
  for (var i = 0; i < n; i++) z.push(_cpmProbit(Math.random()));

  var zc = new Array(n).fill(0);
  for (var i = 0; i < n; i++) {
    for (var k = 0; k <= i; k++) zc[i] += L[i][k] * z[k];
  }

  return zc.map(function(v) { return _cpmNormalCDF(v); });
}

// ─────────────────────────────────────────────
// Risk driver cosine similarity
// ─────────────────────────────────────────────
function _cpmRiskDriverSim(ti, tj) {
  function parseSignals(t) {
    var sigs = t.riskSignals;
    if (!Array.isArray(sigs) || sigs.length === 0) return null;
    var out = {};
    sigs.forEach(function(s) {
      if (typeof s === 'string') out[s] = 1;
      else if (s && s.tag) out[s.tag] = Number.isFinite(s.severity) ? Math.max(0, s.severity) : 1;
    });
    return out;
  }
  var vi = parseSignals(ti), vj = parseSignals(tj);
  if (!vi || !vj) return 0;

  var keys = {};
  Object.keys(vi).forEach(function(k) { keys[k] = true; });
  Object.keys(vj).forEach(function(k) { keys[k] = true; });
  var allKeys = Object.keys(keys);
  if (allKeys.length === 0) return 0;

  var dot = 0, normI = 0, normJ = 0;
  allKeys.forEach(function(k) {
    var a = vi[k] || 0, b = vj[k] || 0;
    dot += a * b; normI += a * a; normJ += b * b;
  });
  var denom = Math.sqrt(normI) * Math.sqrt(normJ);
  return denom > 1e-12 ? dot / denom : 0;
}

function _cpmGraphSim(idI, idJ, graphDistances) {
  if (!graphDistances) return 0;
  var dij = (graphDistances[idI] && graphDistances[idI][idJ] != null) ? graphDistances[idI][idJ] : Infinity;
  var dji = (graphDistances[idJ] && graphDistances[idJ][idI] != null) ? graphDistances[idJ][idI] : Infinity;
  var d   = Math.min(dij, dji);
  if (!Number.isFinite(d)) return 0;
  return Math.exp(-0.5 * d);
}

function _cpmCritSim(idI, idJ, criticalPathSet) {
  if (!criticalPathSet) return 0;
  var ci = criticalPathSet[idI], cj = criticalPathSet[idJ];
  if (ci && cj) return 1.0;
  if (ci || cj) return 0.5;
  return 0;
}

function _cpmMergeSim(idI, idJ, mergeAncestors) {
  if (!mergeAncestors) return 0;
  var shared = 0, total = 0;
  Object.keys(mergeAncestors).forEach(function(m) {
    var anc = mergeAncestors[m];
    var hasI = !!anc[idI], hasJ = !!anc[idJ];
    if (hasI || hasJ) total++;
    if (hasI && hasJ) shared++;
  });
  return total > 0 ? shared / total : 0;
}

// ─────────────────────────────────────────────
// Build task-level correlation matrix R + Cholesky factor L
// ─────────────────────────────────────────────
function _cpmBuildCorrMatrix(tasks, taskIds, detCPMResult, sliderContext, orphanGroups) {
  var n      = tasks.length;
  var rhoMin = CPM_CORR_RHO_MIN;
  var rhoMax = CPM_CORR_RHO_MAX;

  var componentOf = {};
  var compId = 0;
  if (Array.isArray(orphanGroups) && orphanGroups.length > 0) {
    taskIds.forEach(function(id) { componentOf[id] = 0; });
    orphanGroups.forEach(function(group) {
      compId++;
      group.forEach(function(id) { componentOf[id] = compId; });
    });
  }
  var hasComponents = Object.keys(componentOf).length > 0;

  var critSet = null, graphDistances = null, mergeAncestors = null;
  var hasCPMData = !!(detCPMResult && detCPMResult.status === 'ok');
  if (hasCPMData) {
    critSet = {};
    (detCPMResult.criticalPath || []).forEach(function(id) { critSet[id] = true; });
    graphDistances = detCPMResult._graphDistances || null;
    mergeAncestors = detCPMResult._mergeAncestors || null;
  }

  var hasRiskDrivers = tasks.some(function(t) { return Array.isArray(t.riskSignals) && t.riskSignals.length > 0; });
  var hasResource    = tasks.some(function(t) { return t.resource && typeof t.resource === 'string'; });
  var hasPhase       = tasks.some(function(t) { return t.phase && typeof t.phase === 'string'; });

  var wD = hasRiskDrivers  ? 0.45 : 0;
  var wG = hasCPMData      ? (hasPhase ? 0.15 : 0.20) : 0;
  var wC = hasCPMData      ? 0.15 : 0;
  var wM = hasCPMData      ? 0.10 : 0;
  var wR = hasResource     ? 0.10 : 0;
  var wP = hasPhase        ? 0.05 : 0;
  var wTotal = wD + wG + wC + wM + wR + wP;
  if (wTotal < 1e-9) wTotal = 1;

  var mSlider = 1.0;
  if (sliderContext && typeof sliderContext === 'object') {
    var BF = (Number(sliderContext.budgetFlexibility)   || 0) / 100;
    var SC = (Number(sliderContext.scopeCertainty)      || 0) / 100;
    var SF = (Number(sliderContext.scheduleFlexibility) || 0) / 100;
    var RW = (Number(sliderContext.reworkPercentage)    || 0) / 50;
    var UC = (Number(sliderContext.userConfidence)      || 0) / 100;
    mSlider = Math.exp(0.35 * RW - 0.20 * SC - 0.10 * SF - 0.05 * BF - 0.10 * UC);
  }

  var R = [], auditPairs = [];
  for (var i = 0; i < n; i++) {
    R.push([]);
    for (var j = 0; j < n; j++) {
      if (i === j) { R[i].push(1.0); continue; }

      if (hasComponents && componentOf[taskIds[i]] !== componentOf[taskIds[j]]) {
        R[i].push(0); continue;
      }

      var sD = hasRiskDrivers ? _cpmRiskDriverSim(tasks[i], tasks[j]) : 0;
      var sG = hasCPMData     ? _cpmGraphSim(taskIds[i], taskIds[j], graphDistances) : 0;
      var sC = hasCPMData     ? _cpmCritSim(taskIds[i], taskIds[j], critSet)         : 0;
      var sM = hasCPMData     ? _cpmMergeSim(taskIds[i], taskIds[j], mergeAncestors) : 0;
      var sR = (hasResource && tasks[i].resource && tasks[j].resource &&
                tasks[i].resource === tasks[j].resource) ? 1 : 0;
      var sP = (hasPhase && tasks[i].phase && tasks[j].phase &&
                tasks[i].phase === tasks[j].phase) ? 1 : 0;

      var s   = (wD*sD + wG*sG + wC*sC + wM*sM + wR*sR + wP*sP) / wTotal;
      var rho = Math.min(rhoMax, (rhoMin + (rhoMax - rhoMin) * s) * mSlider);
      R[i].push(rho);

      if (i < j && auditPairs.length < 10) {
        auditPairs.push({ i: taskIds[i], j: taskIds[j], rho: _r4(rho), s: _r4(s) });
      }
    }
  }

  var Rrepaired = _cpmHigham(R, 100);
  var L         = _cpmCholesky(Rrepaired);

  return {
    R: Rrepaired, L: L,
    audit: {
      method:                  'cholesky_correlated',
      matrixSize:              n,
      sliderMultiplierApplied: mSlider !== 1.0,
      mSlider:                 _r4(mSlider),
      rhoRange:                [rhoMin, rhoMax],
      driverSignalsPresent:    hasRiskDrivers,
      phaseSignalsPresent:     hasPhase,
      resourceSignalsPresent:  hasResource,
      graphDataPresent:        hasCPMData,
      weightsUsed:             { driver: _r4(wD/wTotal), graph: _r4(wG/wTotal), critical: _r4(wC/wTotal),
                                 merge: _r4(wM/wTotal), resource: _r4(wR/wTotal), phase: _r4(wP/wTotal) },
      samplePairs: auditPairs
    }
  };
}

// ─────────────────────────────────────────────
// Sample a single duration from a task's SACO CDF
// via probability integral transform: u ~ U(0,1) → invertCdf(cdf, u)
// ─────────────────────────────────────────────
function cpmSampleDuration(sacoResult, task, u) {
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

  // PERT normal approximation with probit(u) — samples with full variance, clamped to [O,P]
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
// New parameters (optional, backward-compatible):
//   detCPMResult  — result from runDeterministicCPM
//   sliderContext — slider values for m_slider multiplier
// ─────────────────────────────────────────────
function runStochasticCPM(tasks, sacoResults, graph, order, options, detCPMResult, sliderContext) {
  options = options || {};
  var n = Math.min(
    CPM_STOCHASTIC_MAX_N,
    Math.max(1, Math.round(options.n || CPM_STOCHASTIC_DEFAULT_N))
  );
  var nearCritThreshold = Number.isFinite(options.nearCriticalThreshold) ? options.nearCriticalThreshold : 0.10;

  var taskIds = tasks.map(function(task, idx) { return cpmTaskId(task, idx); });

  // ── Correlation matrix ──
  var L = null, corrAudit = { method: 'independent', reason: 'single_task_or_disabled' };

  if (tasks.length > 1) {
    try {
      var cr = _cpmBuildCorrMatrix(
        tasks, taskIds,
        detCPMResult || null,
        sliderContext || null,
        (detCPMResult && detCPMResult.orphanGroups) || []
      );
      L = cr.L;
      corrAudit = cr.audit;
    } catch (e) {
      corrAudit = { method: 'independent', reason: 'error: ' + (e.message || String(e)) };
    }
  }

  var criticalityCount = {};
  var nciCount         = {};
  order.forEach(function(id) { criticalityCount[id] = 0; nciCount[id] = 0; });

  var projectDurations = [];

  var convergenceNodes = order.filter(function(id) {
    return (graph.reverseAdj[id] || []).length > 1;
  });
  var convergenceEFSum    = {};
  var mergeBottleneckCount = {};
  convergenceNodes.forEach(function(id) {
    convergenceEFSum[id]    = 0;
    mergeBottleneckCount[id] = {};
  });

  var pathFrequency = {};

  // ── Monte Carlo loop ──
  for (var iter = 0; iter < n; iter++) {
    var uVec = L ? _cpmSampleCorrelatedU(L) : null;

    var durations = {};
    tasks.forEach(function(task, idx) {
      var id = taskIds[idx];
      var u  = uVec ? uVec[idx] : Math.random();
      durations[id] = cpmSampleDuration(sacoResults ? sacoResults[idx] : null, task, u);
    });

    var forward = cpmForwardPass(graph, durations, order);

    var projDur = 0;
    graph.sinks.forEach(function(id) {
      if (forward[id]) projDur = Math.max(projDur, forward[id].earlyFinish);
    });
    projectDurations.push(projDur);

    var backward = cpmBackwardPass(graph, durations, order, projDur);
    var floats   = cpmComputeFloats(graph, durations, forward, backward, order);

    var nciThreshold = nearCritThreshold * projDur;
    order.forEach(function(id) {
      if (floats[id].onCriticalPath) {
        criticalityCount[id]++;
      } else if (floats[id].totalFloat <= nciThreshold) {
        nciCount[id]++;
      }
    });

    var pathKey = order.filter(function(id) { return floats[id].onCriticalPath; }).join('→');
    pathFrequency[pathKey] = (pathFrequency[pathKey] || 0) + 1;

    convergenceNodes.forEach(function(id) {
      if (forward[id]) convergenceEFSum[id] += forward[id].earlyFinish;

      var preds = graph.reverseAdj[id] || [];
      if (preds.length < 2) return;
      var maxC = -Infinity, botId = null;
      preds.forEach(function(pred) {
        var lag = Number.isFinite(pred.lag) ? pred.lag : 0;
        var ef  = forward[pred.from] ? forward[pred.from].earlyFinish : 0;
        var c   = ef + lag;
        if (c > maxC) { maxC = c; botId = pred.from; }
      });
      if (botId) mergeBottleneckCount[id][botId] = (mergeBottleneckCount[id][botId] || 0) + 1;
    });
  }

  // ── Post-processing ──
  projectDurations.sort(function(a, b) { return a - b; });

  var meanDur = projectDurations.reduce(function(s, v) { return s + v; }, 0) / n;
  var varDur  = projectDurations.reduce(function(s, v) { return s + (v - meanDur) * (v - meanDur); }, 0) / n;
  var sigDur  = Math.sqrt(varDur);

  function pctIdx(p) { return Math.min(n - 1, Math.floor(n * p)); }

  var criticalityIndex = {}, nci = {}, ssi = {};
  order.forEach(function(id) {
    criticalityIndex[id] = _r4(criticalityCount[id] / n);
    nci[id]              = _r4(nciCount[id] / n);
    var taskIdx   = taskIds.indexOf(id);
    var taskSigma = taskIdx >= 0 ? _cpmTaskSigma(tasks[taskIdx]) : 0;
    ssi[id] = sigDur > 0 ? _r4(criticalityIndex[id] * (taskSigma / sigDur)) : 0;
  });

  var tornado = order.slice()
    .sort(function(a, b) { return ssi[b] - ssi[a]; })
    .map(function(id) {
      return { id: id, name: graph.nodes[id] ? graph.nodes[id].name : id,
               ssi: ssi[id], criticalityIndex: criticalityIndex[id], nci: nci[id] };
    });

  var minDur = projectDurations[0], maxDur = projectDurations[n - 1];
  var sCurve = [];
  for (var i = 0; i <= 24; i++) {
    var d = minDur + (maxDur - minDur) * (i / 24);
    var count = 0;
    projectDurations.forEach(function(v) { if (v <= d) count++; });
    sCurve.push({ x: _r4(d), y: _r4(count / n) });
  }

  var mergePointBias = {}, mergeBottleneck = {};
  convergenceNodes.forEach(function(id) {
    mergePointBias[id] = _r4(convergenceEFSum[id] / n);
    var counts = mergeBottleneckCount[id];
    var topId  = null, topCount = 0;
    Object.keys(counts).forEach(function(pid) { if (counts[pid] > topCount) { topCount = counts[pid]; topId = pid; } });
    if (topId) mergeBottleneck[id] = { bottleneckTask: topId, frequency: _r4(topCount / n) };
  });

  var pathEntries = Object.keys(pathFrequency)
    .map(function(k) { return { path: k, frequency: _r4(pathFrequency[k] / n) }; })
    .sort(function(a, b) { return b.frequency - a.frequency; })
    .slice(0, 5);

  return {
    status:       'ok',
    iterations:   n,
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
    nci:              nci,
    ssi:              ssi,
    tornado:          tornado,
    mergePointBias:   mergePointBias,
    mergeBottleneck:  mergeBottleneck,
    topCriticalPaths: pathEntries,
    correlationAudit: corrAudit
  };
}
