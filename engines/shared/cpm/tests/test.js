/**
 * cp-engine/test.js — Accuracy test suite for CP Engine
 * Project Advisor — CP Engine v1.0
 *
 * All expected values are hand-calculated from first principles.
 * Run: node engines/shared/cpm/tests/test.js  (from repo root)
 *
 * Test coverage:
 *   T01  Graph construction (nodes, edges, sources, sinks)
 *   T02  Validation (self-ref, missing pred, duplicate pred)
 *   T03  Cycle detection — Tarjan SCC, single cycle
 *   T04  Cycle detection — multiple cycles
 *   T05  Topological sort — Kahn's, simple chain
 *   T06  Topological sort — fails on cyclic graph
 *   T07  Forward pass — FS, linear chain
 *   T08  Forward pass — FS, fork-join diamond
 *   T09  Forward pass — SS with lag
 *   T10  Forward pass — FF with lag
 *   T11  Forward pass — FS with positive lag
 *   T12  Backward pass — linear chain
 *   T13  Backward pass — fork-join diamond
 *   T14  Float computation — linear chain (all zero)
 *   T15  Float computation — fork-join diamond (C has float)
 *   T16  Float computation — 5-task network (C has TF=2, FF=2)
 *   T17  Float computation — negative float
 *   T18  Tipping point — critical task = 0, non-critical ordered by severity
 *   T19  Graph metrics — density, convergence nodes
 *   T20  Duration extraction — optimized CDF P80
 *   T21  Duration extraction — fallback to baseline CDF
 *   T22  Duration extraction — fallback to PERT mean
 *   T23  Full deterministic CPM — linear chain
 *   T24  Full deterministic CPM — fork-join diamond (critical path, floats)
 *   T25  Full deterministic CPM — cycle returns error
 *   T26  Full deterministic CPM — validation errors reported
 *   T27  Orphan detection — two disconnected components
 *   T28  Stochastic CPM — deterministic input → criticality index = 1.0 on crit path
 *   T29  Stochastic CPM — S-curve endpoints valid
 *   T30  Stochastic CPM — SSI tornado ordered descending
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

// ─── Load all modules into global scope via vm ───────────────────────────────
// (GAS files are global-scope; we replicate that by injecting into global)
function loadGS(relPath) {
  const fullPath = path.join(__dirname, relPath);
  const code = fs.readFileSync(fullPath, 'utf8')
    .replace(/^\/\/ Ported from.*\n/m, ''); // strip port header if present
  vm.runInThisContext(code, { filename: fullPath });
}

// Load real invertCdf and ensureSortedMonotoneCdf from shared SACO engine
loadGS('../../saco/helpers/metrics.js');

// Load CP engine modules (order matters — dependencies first)
loadGS('../graph.js');
loadGS('../cpm-engine.js');
loadGS('../stochastic-cpm.js');
loadGS('../cpm-adapter.js');

// ─── Test runner ─────────────────────────────────────────────────────────────
var passed = 0;
var failed = 0;
var TOLERANCE = 0.001;

function check(label, actual, expected, tolerance) {
  tolerance = tolerance !== undefined ? tolerance : TOLERANCE;
  var ok;
  if (typeof expected === 'boolean' || expected === null || expected === undefined) {
    ok = actual === expected;
  } else if (Array.isArray(expected)) {
    ok = Array.isArray(actual) &&
         actual.length === expected.length &&
         expected.every(function(v, i) { return actual[i] === v; });
  } else if (typeof expected === 'number') {
    ok = Math.abs(actual - expected) <= tolerance;
  } else {
    ok = actual === expected;
  }
  if (ok) {
    console.log('  PASS  ' + label);
    passed++;
  } else {
    console.error('  FAIL  ' + label);
    console.error('        expected: ' + JSON.stringify(expected));
    console.error('        actual:   ' + JSON.stringify(actual));
    failed++;
  }
}

function section(title) {
  console.log('\n── ' + title + ' ──');
}

// ─── Helper: build minimal SACO result mock for a fixed duration ──────────────
// Returns a fake sacoResult where the optimized CDF maps every percentile to `dur`.
function mockSacoFixed(dur) {
  var eps = 0.0001;
  var cdf = [{ x: dur - eps, y: 0 }, { x: dur, y: 1 }];
  return {
    optimize: { reshapedPoints: { cdfPoints: cdf } },
    baseline: { monteCarloSmoothed: { cdfPoints: cdf } }
  };
}

// Stub for tasks that bypass SACO (CP-only mode — use task.duration directly)
function taskDuration(name, dur, predecessors) {
  return { task: name, duration: dur, predecessors: predecessors || [] };
}

// ─── Test networks (hand-calculated) ─────────────────────────────────────────
/*
  NETWORK A: linear chain  A(3)→B(5)→C(4)
    EarlyStart:  A=0, B=3, C=8
    EarlyFinish: A=3, B=8, C=12
    LateStart:   A=0, B=3, C=8
    LateFinish:  A=3, B=8, C=12
    TotalFloat:  all 0
    CriticalPath: [A,B,C]
    ProjectDuration: 12
*/
var netA = [
  taskDuration('A', 3, []),
  taskDuration('B', 5, ['A']),
  taskDuration('C', 4, ['B'])
];

/*
  NETWORK B: fork-join diamond
         B(5)
        /     \
    A(3)       D(2)
        \     /
         C(4)
    FS dependencies: A→B, A→C, B→D, C→D

    Forward:  A(0,3), B(3,8), C(3,7), D(8,10)
    Backward: D(8,10), B(3,8), C(4,8), A(0,3)
    TotalFloat: A=0, B=0, C=1, D=0
    FreeFloat:  A=0, B=0, C=1, D=0
    CriticalPath: [A, B, D]
    ProjectDuration: 10
*/
var netB = [
  taskDuration('A', 3, []),
  taskDuration('B', 5, ['A']),
  taskDuration('C', 4, ['A']),
  taskDuration('D', 2, ['B', 'C'])
];

/*
  NETWORK C: 5-task, two paths of different length
    A(2)→B(5)→D(4)→E(2)
    A(2)→C(3)→D(4)
    FS all.

    Forward:  A(0,2), B(2,7), C(2,5), D(7,11), E(11,13)
    Backward: E(11,13), D(7,11), B(2,7), C(4,7 [D's LS=7]), A(0,2)
    TotalFloat: A=0,B=0,C=2,D=0,E=0
    FreeFloat:  C: min(D's ES - C's EF) = 7-5=2 → FF=2
    CriticalPath: [A, B, D, E]
    ProjectDuration: 13
*/
var netC = [
  taskDuration('A', 2, []),
  taskDuration('B', 5, ['A']),
  taskDuration('C', 3, ['A']),
  taskDuration('D', 4, ['B', 'C']),
  taskDuration('E', 2, ['D'])
];

/*
  NETWORK D: SS with lag=2
    A(5), B(3), A→B type SS lag=2
    Forward:  A(ES=0,EF=5), B(ES=2,EF=5)
    Backward: (both sinks, project end=5)
              B(LS=2,LF=5), A(LS=0,LF=5)
    TotalFloat: A=0, B=0
    ProjectDuration: 5
*/
var netD = [
  taskDuration('A', 5, []),
  { task: 'B', duration: 3, predecessors: [{ id: 'A', type: 'SS', lag: 2 }] }
];

/*
  NETWORK E: FF with lag=1
    A(5), B(3), A→B type FF lag=1
    Forward:  A(0,5), B(ES=EF_A+lag-dur_B=5+1-3=3, EF=6)
    Backward: (B is sink, A constrained by FF)
              B(LS=3,LF=6), A: LF=B's LF - lag=6-1=5, LS=0
    TotalFloat: A=5-5=0, B=6-6=0
    ProjectDuration: 6
*/
var netE = [
  taskDuration('A', 5, []),
  { task: 'B', duration: 3, predecessors: [{ id: 'A', type: 'FF', lag: 1 }] }
];

/*
  NETWORK F: FS with positive lag=2
    A(3), B(4), A→B FS lag=2
    Forward: A(0,3), B(ES=3+2=5, EF=9)
    Backward: B(LS=5,LF=9), A(LF=B's LS-lag=5-2=3, LS=0)
    TotalFloat: A=3-3=0, B=9-9=0
    ProjectDuration: 9
*/
var netF = [
  taskDuration('A', 3, []),
  { task: 'B', duration: 4, predecessors: [{ id: 'A', type: 'FS', lag: 2 }] }
];

// ─── T01: Graph construction ──────────────────────────────────────────────────
section('T01 Graph construction');
var gA = cpmBuildGraph(netA);
check('T01a nodeCount', Object.keys(gA.nodes).length, 3);
check('T01b edgeCount', gA.edges.length, 2);
check('T01c sources = [A]', gA.sources.length, 1);
check('T01d sources[0] = A', gA.sources[0], 'A');
check('T01e sinks = [C]', gA.sinks[0], 'C');
check('T01f A has no predecessors', gA.reverseAdj['A'].length, 0);
check('T01g B predecessor is A', gA.reverseAdj['B'][0].from, 'A');
check('T01h B→C edge type is FS', gA.adjacency['B'][0].type, 'FS');

// ─── T02: Validation ──────────────────────────────────────────────────────────
section('T02 Validation');
var selfRef    = [{ task: 'X', duration: 3, predecessors: ['X'] }];
var missingRef = [{ task: 'X', duration: 3, predecessors: ['Z'] }];
var dupRef     = [
  taskDuration('A', 3, []),
  { task: 'B', duration: 4, predecessors: [{ id: 'A', type: 'FS' }, { id: 'A', type: 'FS' }] }
];
var gSelf = cpmBuildGraph(selfRef);
var gMiss = cpmBuildGraph(missingRef);
var gDup  = cpmBuildGraph(dupRef);
var vSelf = cpmValidateGraph(selfRef, gSelf);
var vMiss = cpmValidateGraph(missingRef, gMiss);
var vDup  = cpmValidateGraph(dupRef, gDup);
check('T02a self-reference invalid', vSelf.valid, false);
check('T02b self-reference code', vSelf.errors[0].code, 'SELF_REFERENCE');
check('T02c missing predecessor invalid', vMiss.valid, false);
check('T02d missing predecessor code', vMiss.errors[0].code, 'MISSING_PREDECESSOR');
check('T02e duplicate predecessor invalid', vDup.valid, false);
check('T02f duplicate predecessor code', vDup.errors[0].code, 'DUPLICATE_PREDECESSOR');
var vA = cpmValidateGraph(netA, gA);
check('T02g valid network passes', vA.valid, true);

// ─── T03: Cycle detection — single cycle ─────────────────────────────────────
section('T03 Cycle detection');
var cyclic1 = [
  taskDuration('A', 2, ['C']),
  taskDuration('B', 3, ['A']),
  taskDuration('C', 4, ['B'])
];
var gCyc1   = cpmBuildGraph(cyclic1);
var cycles1 = cpmDetectCycles(gCyc1);
check('T03a single cycle detected', cycles1.length, 1);
check('T03b cycle involves 3 nodes', cycles1[0].length, 3);
var noCycles = cpmDetectCycles(gA);
check('T03c acyclic graph returns []', noCycles.length, 0);

// ─── T04: Cycle detection — two independent cycles ───────────────────────────
section('T04 Multiple cycles');
var cyclic2 = [
  taskDuration('A', 2, ['B']),  // cycle 1: A↔B
  taskDuration('B', 3, ['A']),
  taskDuration('C', 2, ['D']),  // cycle 2: C↔D
  taskDuration('D', 3, ['C'])
];
var gCyc2   = cpmBuildGraph(cyclic2);
var cycles2 = cpmDetectCycles(gCyc2);
check('T04a two cycles detected', cycles2.length, 2);

// ─── T05: Topological sort — Kahn's ──────────────────────────────────────────
section('T05 Topological sort');
var topoA = cpmTopologicalSort(gA);
check('T05a success on acyclic', topoA.success, true);
check('T05b order length = 3', topoA.order.length, 3);
check('T05c A comes first', topoA.order[0], 'A');
check('T05d C comes last', topoA.order[2], 'C');

// ─── T06: Topological sort fails on cycle ────────────────────────────────────
section('T06 Topological sort on cyclic graph');
var topoC = cpmTopologicalSort(gCyc1);
check('T06a fails on cyclic graph', topoC.success, false);

// ─── T07: Forward pass — linear chain ────────────────────────────────────────
section('T07 Forward pass linear chain');
var durA = { A: 3, B: 5, C: 4 };
var fwA  = cpmForwardPass(gA, durA, topoA.order);
check('T07a A.earlyStart', fwA['A'].earlyStart, 0);
check('T07b A.earlyFinish', fwA['A'].earlyFinish, 3);
check('T07c B.earlyStart', fwA['B'].earlyStart, 3);
check('T07d B.earlyFinish', fwA['B'].earlyFinish, 8);
check('T07e C.earlyStart', fwA['C'].earlyStart, 8);
check('T07f C.earlyFinish', fwA['C'].earlyFinish, 12);

// ─── T08: Forward pass — fork-join diamond ───────────────────────────────────
section('T08 Forward pass diamond');
var gB   = cpmBuildGraph(netB);
var topoB = cpmTopologicalSort(gB);
var durB = { A: 3, B: 5, C: 4, D: 2 };
var fwB  = cpmForwardPass(gB, durB, topoB.order);
check('T08a A.earlyFinish', fwB['A'].earlyFinish, 3);
check('T08b B.earlyFinish', fwB['B'].earlyFinish, 8);
check('T08c C.earlyFinish', fwB['C'].earlyFinish, 7);
check('T08d D.earlyStart',  fwB['D'].earlyStart,  8);  // max(EF_B=8, EF_C=7) = 8
check('T08e D.earlyFinish', fwB['D'].earlyFinish, 10);

// ─── T09: Forward pass — SS with lag ─────────────────────────────────────────
section('T09 Forward pass SS lag=2');
var gD   = cpmBuildGraph(netD);
var topoD = cpmTopologicalSort(gD);
var durD = { A: 5, B: 3 };
var fwD  = cpmForwardPass(gD, durD, topoD.order);
check('T09a A.earlyFinish', fwD['A'].earlyFinish, 5);
check('T09b B.earlyStart',  fwD['B'].earlyStart,  2);  // SS: ES_B = ES_A + lag = 0+2=2
check('T09c B.earlyFinish', fwD['B'].earlyFinish, 5);

// ─── T10: Forward pass — FF with lag ─────────────────────────────────────────
section('T10 Forward pass FF lag=1');
var gE   = cpmBuildGraph(netE);
var topoE = cpmTopologicalSort(gE);
var durE = { A: 5, B: 3 };
var fwE  = cpmForwardPass(gE, durE, topoE.order);
check('T10a B.earlyStart',  fwE['B'].earlyStart,  3);  // FF: ES_B = EF_A+lag-dur_B=5+1-3=3
check('T10b B.earlyFinish', fwE['B'].earlyFinish, 6);  // 3+3=6

// ─── T11: Forward pass — FS with positive lag ────────────────────────────────
section('T11 Forward pass FS lag=2');
var gF    = cpmBuildGraph(netF);
var topoF = cpmTopologicalSort(gF);
var durF  = { A: 3, B: 4 };
var fwF   = cpmForwardPass(gF, durF, topoF.order);
check('T11a B.earlyStart',  fwF['B'].earlyStart,  5);  // FS: ES_B = EF_A + lag = 3+2=5
check('T11b B.earlyFinish', fwF['B'].earlyFinish, 9);

// ─── T12: Backward pass — linear chain ───────────────────────────────────────
section('T12 Backward pass linear chain');
var bwA = cpmBackwardPass(gA, durA, topoA.order, 12);
check('T12a C.lateFinish', bwA['C'].lateFinish, 12);
check('T12b C.lateStart',  bwA['C'].lateStart,  8);
check('T12c B.lateFinish', bwA['B'].lateFinish, 8);
check('T12d B.lateStart',  bwA['B'].lateStart,  3);
check('T12e A.lateFinish', bwA['A'].lateFinish, 3);
check('T12f A.lateStart',  bwA['A'].lateStart,  0);

// ─── T13: Backward pass — fork-join diamond ──────────────────────────────────
section('T13 Backward pass diamond');
var bwB = cpmBackwardPass(gB, durB, topoB.order, 10);
check('T13a D.lateFinish', bwB['D'].lateFinish, 10);
check('T13b D.lateStart',  bwB['D'].lateStart,  8);
check('T13c B.lateFinish', bwB['B'].lateFinish, 8);
check('T13d C.lateFinish', bwB['C'].lateFinish, 8);  // C can finish as late as 8
check('T13e C.lateStart',  bwB['C'].lateStart,  4);  // 8-4=4
check('T13f A.lateFinish', bwB['A'].lateFinish, 3);  // min(B's LS=3, C's LS=4)=3

// ─── T14: Float — linear chain (all zero) ────────────────────────────────────
section('T14 Float linear chain');
var flA = cpmComputeFloats(gA, durA, fwA, bwA, topoA.order);
check('T14a A.totalFloat', flA['A'].totalFloat, 0);
check('T14b B.totalFloat', flA['B'].totalFloat, 0);
check('T14c C.totalFloat', flA['C'].totalFloat, 0);
check('T14d A.onCriticalPath', flA['A'].onCriticalPath, true);
check('T14e B.onCriticalPath', flA['B'].onCriticalPath, true);
check('T14f C.onCriticalPath', flA['C'].onCriticalPath, true);

// ─── T15: Float — diamond (C has TF=1, FF=1) ─────────────────────────────────
section('T15 Float diamond');
var flB = cpmComputeFloats(gB, durB, fwB, bwB, topoB.order);
check('T15a A.totalFloat', flB['A'].totalFloat, 0);
check('T15b B.totalFloat', flB['B'].totalFloat, 0);
check('T15c C.totalFloat', flB['C'].totalFloat, 1);  // LF-EF = 8-7 = 1
check('T15d C.freeFloat',  flB['C'].freeFloat,  1);  // D's ES(8) - C's EF(7) = 1
check('T15e D.totalFloat', flB['D'].totalFloat, 0);
check('T15f C.onCriticalPath', flB['C'].onCriticalPath, false);
check('T15g B.onCriticalPath', flB['B'].onCriticalPath, true);

// ─── T16: Float — 5-task network (C has TF=2, FF=2) ─────────────────────────
section('T16 Float 5-task network');
var gC    = cpmBuildGraph(netC);
var topoC2 = cpmTopologicalSort(gC);
var durC  = { A: 2, B: 5, C: 3, D: 4, E: 2 };
var fwC   = cpmForwardPass(gC, durC, topoC2.order);
var bwC   = cpmBackwardPass(gC, durC, topoC2.order, 13);
var flC   = cpmComputeFloats(gC, durC, fwC, bwC, topoC2.order);
check('T16a C.earlyFinish', fwC['C'].earlyFinish, 5);   // ES=2, dur=3 → EF=5
check('T16b D.earlyStart',  fwC['D'].earlyStart,  7);   // max(B's EF=7, C's EF=5)=7
check('T16c C.totalFloat',  flC['C'].totalFloat,  2);   // LF(7)-EF(5)=2
check('T16d C.freeFloat',   flC['C'].freeFloat,   2);   // D's ES(7)-C's EF(5)=2
check('T16e C.interferingFloat', flC['C'].interferingFloat, 0); // TF-FF=2-2=0
check('T16f A.onCriticalPath', flC['A'].onCriticalPath, true);
check('T16g C.onCriticalPath', flC['C'].onCriticalPath, false);
check('T16h projectDuration', fwC['E'].earlyFinish, 13);

// ─── T17: Float — negative float ─────────────────────────────────────────────
section('T17 Negative float');
// Force backward pass with projectEnd=8 on network that takes 12 → TF = 8-12 = -4 on C
var bwA_neg = cpmBackwardPass(gA, durA, topoA.order, 8);
var flA_neg = cpmComputeFloats(gA, durA, fwA, bwA_neg, topoA.order);
check('T17a C.totalFloat negative', flA_neg['C'].totalFloat, -4);  // LF(8)-EF(12)=-4
check('T17b A.totalFloat negative', flA_neg['A'].totalFloat, -4);

// ─── T18: Tipping points ──────────────────────────────────────────────────────
section('T18 Tipping points');
var tpC = cpmComputeTippingPoints(gC, flC, 13, topoC2.order);
check('T18a A (critical) tippingPoint=0',  tpC['A'].tippingPoint, 0);
check('T18b A severity=CRITICAL', tpC['A'].severity, 'CRITICAL');
check('T18c C (non-critical) tippingPoint=2', tpC['C'].tippingPoint, 2);
// C's float=2, threshold10%=1.3, threshold25%=3.25 → severity HIGH (2 < 3.25 but > 1.3) → MEDIUM
check('T18d C severity', tpC['C'].severity, 'MEDIUM');

// ─── T19: Graph metrics ───────────────────────────────────────────────────────
section('T19 Graph metrics');
var gmB = cpmGraphMetrics(gB);
check('T19a nodeCount', gmB.nodeCount, 4);
check('T19b edgeCount', gmB.edgeCount, 4);
check('T19c convergenceCount', gmB.convergenceCount, 1);  // D has 2 predecessors
check('T19d convergenceNode is D', gmB.convergenceNodes[0], 'D');
// density = 4 / (4*3) = 4/12 = 0.3333
check('T19e density', gmB.density, 4/12, 0.001);

// ─── T20: Duration extraction — optimized CDF P80 ────────────────────────────
section('T20 Duration extraction from SACO CDF');
// Build a simple linear CDF: x from 5 to 15, y from 0 to 1 (uniform on [5,15])
var linearCdf = [];
for (var i = 0; i <= 10; i++) {
  linearCdf.push({ x: 5 + i, y: i / 10 });
}
var fakeSaco = {
  optimize:  { reshapedPoints: { cdfPoints: linearCdf } },
  baseline:  { monteCarloSmoothed: { cdfPoints: linearCdf } }
};
var dur80 = cpmExtractDuration(fakeSaco, {}, 0.80);
check('T20a P80 on uniform[5,15] = 13', dur80, 13, 0.01);
var dur50 = cpmExtractDuration(fakeSaco, {}, 0.50);
check('T20b P50 on uniform[5,15] = 10', dur50, 10, 0.01);

// ─── T21: Duration extraction — fallback to baseline ─────────────────────────
section('T21 Duration extraction fallback to baseline');
var noOpt = { optimize: null, baseline: { monteCarloSmoothed: { cdfPoints: linearCdf } } };
var durFallback = cpmExtractDuration(noOpt, {}, 0.80);
check('T21a fallback to baseline CDF', durFallback, 13, 0.01);

// ─── T22: Duration extraction — fallback to PERT mean ────────────────────────
section('T22 Duration extraction fallback PERT mean');
var noSaco   = { optimize: null, baseline: null };
var pertTask = { optimistic: 4, mostLikely: 7, pessimistic: 10 };
var durPert  = cpmExtractDuration(noSaco, pertTask, 0.80);
// PERT mean = (4+4*7+10)/6 = (4+28+10)/6 = 42/6 = 7
check('T22a PERT mean fallback = 7', durPert, 7, 0.001);

// ─── T23: Full deterministic CPM — linear chain ──────────────────────────────
section('T23 Full deterministic CPM linear chain');
var sacoA = netA.map(function(t) { return mockSacoFixed(t.duration); });
var cpmA  = runDeterministicCPM(netA, sacoA, { cpmPercentile: 0.80 });
check('T23a status ok', cpmA.status, 'ok');
check('T23b projectDuration', cpmA.projectDuration, 12, 0.001);
check('T23c criticalPath length', cpmA.criticalPath.length, 3);
check('T23d A on critical path', cpmA.tasks['A'].onCriticalPath, true);
check('T23e B on critical path', cpmA.tasks['B'].onCriticalPath, true);
check('T23f C on critical path', cpmA.tasks['C'].onCriticalPath, true);
check('T23g no orphans', cpmA.orphanGroups.length, 0);

// ─── T24: Full deterministic CPM — fork-join diamond ─────────────────────────
section('T24 Full deterministic CPM diamond');
var sacoB = netB.map(function(t) { return mockSacoFixed(t.duration); });
var cpmB  = runDeterministicCPM(netB, sacoB, { cpmPercentile: 0.80 });
check('T24a status ok', cpmB.status, 'ok');
check('T24b projectDuration', cpmB.projectDuration, 10, 0.001);
check('T24c criticalPath length', cpmB.criticalPath.length, 3);
check('T24d C not on critical path', cpmB.tasks['C'].onCriticalPath, false);
check('T24e C totalFloat', cpmB.tasks['C'].totalFloat, 1, 0.001);
check('T24f C freeFloat',  cpmB.tasks['C'].freeFloat,  1, 0.001);
check('T24g merge bias warning present', cpmB.mergePointBiasWarning !== null, true);
check('T24h D is convergence node', cpmB.graphMetrics.convergenceNodes.indexOf('D') >= 0, true);

// ─── T25: Full CPM — cycle returns structured error ──────────────────────────
section('T25 CPM returns error on cycle');
var sacoC = cyclic1.map(function(t) { return mockSacoFixed(t.duration || 3); });
var cpmCyc = runDeterministicCPM(cyclic1, sacoC, {});
check('T25a status error', cpmCyc.status, 'error');
check('T25b code CYCLES_DETECTED', cpmCyc.code, 'CYCLES_DETECTED');
check('T25c cycles count', cpmCyc.cycles.length, 1);
check('T25d cycleDescriptions present', Array.isArray(cpmCyc.cycleDescriptions), true);

// ─── T26: Full CPM — validation errors reported but run continues ─────────────
section('T26 CPM reports validation errors');
// Network with one valid dep and one self-ref (self-ref is filtered at graph build,
// so CPM runs but validation error is in the response)
var netSelfRef = [
  taskDuration('A', 3, []),
  { task: 'B', duration: 4, predecessors: ['A', 'B'] } // B→B self-reference
];
var sacoSR = netSelfRef.map(function(t) { return mockSacoFixed(t.duration); });
var cpmSR  = runDeterministicCPM(netSelfRef, sacoSR, {});
check('T26a validationErrors captured', cpmSR.validationErrors.length >= 1, true);
check('T26b self-ref error code', cpmSR.validationErrors[0].code, 'SELF_REFERENCE');

// ─── T27: Orphan detection ────────────────────────────────────────────────────
section('T27 Orphan detection');
var netOrphan = [
  taskDuration('A', 3, []),
  taskDuration('B', 4, ['A']),
  taskDuration('X', 5, []),  // disconnected island
  taskDuration('Y', 2, ['X'])
];
var gOrphan    = cpmBuildGraph(netOrphan);
var orphanGrps = cpmFindOrphans(gOrphan);
check('T27a orphan group count', orphanGrps.length, 1);
check('T27b orphan group size', orphanGrps[0].length, 2);
// Orphan group contains X and Y (or A and B, depending on which is smaller)
check('T27c orphan group has 2 nodes', orphanGrps[0].length, 2);

// ─── T28: Stochastic CPM — deterministic input → criticality index on CP = 1 ──
section('T28 Stochastic CPM criticality index');
// When all tasks have fixed durations (mockSacoFixed), the critical path never changes.
// So criticalityIndex for A, B, D should approach 1.0 and C should approach 0.0.
var sacoB2   = netB.map(function(t) { return mockSacoFixed(t.duration); });
var gB2      = cpmBuildGraph(netB);
var topoB2   = cpmTopologicalSort(gB2);
var stochB   = runStochasticCPM(netB, sacoB2, gB2, topoB2.order, { n: 100 });
check('T28a status ok', stochB.status, 'ok');
check('T28b A criticality = 1', stochB.criticalityIndex['A'], 1.0, 0.001);
check('T28c B criticality = 1', stochB.criticalityIndex['B'], 1.0, 0.001);
check('T28d D criticality = 1', stochB.criticalityIndex['D'], 1.0, 0.001);
check('T28e C criticality = 0', stochB.criticalityIndex['C'], 0.0, 0.001);

// ─── T29: Stochastic CPM — S-curve endpoints valid ───────────────────────────
section('T29 Stochastic CPM S-curve');
check('T29a sCurve length > 0', stochB.sCurve.length > 0, true);
// With fixed (degenerate) durations all iterations = same duration → min=max → first point y=1
check('T29b sCurve first y = 1 (degenerate fixed durations)', stochB.sCurve[0].y, 1, 0.001);
check('T29c sCurve last y = 1', stochB.sCurve[stochB.sCurve.length - 1].y, 1, 0.001);
// With fixed durations, all iterations = 10, so P50=P80=P90=10
check('T29d projectDuration p50 = 10', stochB.projectDuration.p50, 10, 0.001);
check('T29e projectDuration p80 = 10', stochB.projectDuration.p80, 10, 0.001);
check('T29f sigma = 0 for fixed durations', stochB.projectDuration.sigma, 0, 0.001);

// ─── T30: Stochastic CPM — SSI tornado ordered descending ────────────────────
section('T30 Stochastic CPM SSI tornado ordering');
// With variable durations, tornado must be sorted descending by SSI
var netVar = [
  { task: 'A', optimistic: 1, mostLikely: 3, pessimistic: 8, predecessors: [] },
  { task: 'B', optimistic: 2, mostLikely: 5, pessimistic: 12, predecessors: ['A'] },
  { task: 'C', optimistic: 1, mostLikely: 2, pessimistic: 3,  predecessors: ['A'] },
  { task: 'D', optimistic: 1, mostLikely: 3, pessimistic: 6,  predecessors: ['B', 'C'] }
];
var sacoVar = netVar.map(function(t) {
  // Build a simple CDF from O to P with PERT mean at center
  var mean = (t.optimistic + 4*t.mostLikely + t.pessimistic)/6;
  var cdfV = [
    { x: t.optimistic, y: 0 },
    { x: mean, y: 0.5 },
    { x: t.pessimistic, y: 1 }
  ];
  return { optimize: { reshapedPoints: { cdfPoints: cdfV } },
           baseline: { monteCarloSmoothed: { cdfPoints: cdfV } } };
});
var gVar    = cpmBuildGraph(netVar);
var topoVar = cpmTopologicalSort(gVar);
var stochVar = runStochasticCPM(netVar, sacoVar, gVar, topoVar.order, { n: 200 });
check('T30a status ok', stochVar.status, 'ok');
check('T30b tornado length = 4', stochVar.tornado.length, 4);
var tornado = stochVar.tornado;
var ssiOrdered = true;
for (var i = 1; i < tornado.length; i++) {
  if (tornado[i].ssi > tornado[i-1].ssi + 0.001) { ssiOrdered = false; break; }
}
check('T30c tornado sorted descending by SSI', ssiOrdered, true);

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(50));
console.log('Results: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed+failed) + ' checks');
if (failed > 0) {
  console.error('SOME TESTS FAILED');
  process.exit(1);
} else {
  console.log('ALL TESTS PASSED');
  process.exit(0);
}
