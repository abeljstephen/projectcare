// Ported from system-google-sheets-addon/core/report/playbooks.gs
// File: report/playbooks.gs
// Lightweight rule engine ("playbooks") to turn model outputs into human-meaningful diagnostics, counter-intuition flags, and recommendations. v1.9.24
// Cleaned & FIXED for pure Apps Script - global scope, no Node.js
// Fixed: removed invalid 'recs.push' in counterIntuitionBlock (scope error)

var MODE_LABELS = {
  fixed: 'Fixed Grid',
  'adaptive-tilt': 'Adaptive Tilt',
  'adaptive-fixed': 'Adaptive Fixed',
  manual: 'Manual Adjust',
  'saco-fixed': 'SACO Fixed (coarse, maxIter=60)',
  'saco-adaptive': 'SACO Adaptive (seed ±20%, probe=1-7, drift<5%)'
};

function getModeBadge(mode, hasSeed = false) {
  if (!mode || typeof mode !== 'string') return 'Unknown Mode';
  const cleanMode = mode.toLowerCase().trim().replace('saco-', '');
  const label = MODE_LABELS[cleanMode] || 'Unknown Mode';
  const sacoPrefix = mode.startsWith('saco-') ? 'SACO ' : '';
  const chainSuffix = hasSeed && cleanMode.includes('adaptive') ? ' (chained)' : '';
  return sacoPrefix + label.replace(/,/g, ';') + chainSuffix;
}

var _pb_pct = (v) => (Number.isFinite(v) ? (v * 100) : null);
var _pb_clamp01 = (x) => Math.max(0, Math.min(1, Number(x)));
var round = (v, d=2) => Number.isFinite(v) ? Number(v.toFixed(d)) : v;

function bandOf01(v) {
  if (!Number.isFinite(v)) return 'Zero';
  const p = v * 100;
  if (p <= 0) return 'Zero';
  if (p <= 25) return '0–25';
  if (p <= 50) return '26–50';
  if (p <= 75) return '51–75';
  return '76–100';
}

function _pb_asArray(x) { return Array.isArray(x) ? x : []; }
function byAbsDesc(a, b) { return Math.abs((b || 0)) - Math.abs((a || 0)); }

function coalesceCategory(s) {
  const m = String(s||'').toLowerCase();
  if (/capac/.test(m)) return 'capacity';
  if (/certain|scopecert/.test(m)) return 'certainty';
  if (/process|rework/.test(m)) return 'process';
  if (/behav|risk/.test(m)) return 'behavioral';
  return 'other';
}

function summarizeSliders(sliders) {
  const rows = _pb_asArray(sliders).map(s => {
    const v = _pb_clamp01(s?.value ?? 0);
    const cat = coalesceCategory(s?.category || s?.slider);
    const dRaw  = Number(s?.contribution?.deltaTargetProbFromRaw ?? 0);
    const dProj = Number(s?.contribution?.shareOfProjectionLift ?? 0);
    return {
      name: String(s?.slider || 'unknown'),
      category: cat,
      value01: v,
      valuePct: Math.round(v*100),
      band: bandOf01(v),
      delta: dRaw + dProj,
      deltaRaw: dRaw,
      deltaProj: dProj
    };
  });

  const byMag = [...rows].sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta));
  const top3 = byMag.slice(0,3);

  const catTotals = rows.reduce((acc, r) => {
    acc[r.category] = (acc[r.category] || 0) + (r.delta || 0);
    return acc;
  }, {});

  const neg = [...rows].filter(r => r.delta < 0).sort(byAbsDesc);
  const dominantNegative = neg[0] || null;

  const winning = {};
  rows.forEach(r => { winning[r.name] = r.valuePct; });

  const bands = {};
  rows.forEach(r => { bands[r.name] = r.band; });

  const sliderCategories = {};
  rows.forEach(r => { sliderCategories[r.name] = r.category; });

  return { rows, top3, catTotals, dominantNegative, winning, bands, sliderCategories };
}

function diagnosticsBlock(ctx, rollup) {
  const base = ctx?.baselineProbability;
  const fin  = ctx?.finalProbability;

  let mono = 'N/A';
  if (Number.isFinite(base) && Number.isFinite(fin)) {
    mono = (fin + 1e-12 >= base) ? 'Pass' : 'Warn';
  }

  let zeroPass = 'N/A';
  if (rollup && rollup.rows.length) {
    const sum01 = rollup.rows.reduce((s,r)=>s + (r.value01||0), 0);
    if (sum01 < 1e-6) {
      if (Number.isFinite(base) && Number.isFinite(fin)) {
        zeroPass = (Math.abs(fin - base) < 1e-6) ? 'Pass' : 'Fail';
      }
    }
  }

  let chainingDrift = 'N/A';
  if (ctx?.explain?.mode?.includes('adaptive') && ctx.explain.seedBest) {
    const driftPct = Math.abs((fin - ctx.explain.seedBest.finalProb) / ctx.explain.seedBest.finalProb) * 100;
    chainingDrift = driftPct < 5 ? 'Pass' : 'Warn';
  }

  return {
    monotonicityAtTarget: mono,
    allZeroSlidersPassThrough: zeroPass,
    chainingDrift
  };
}

function counterIntuitionBlock(ctx, rollup) {
  const out = [];
  if (!rollup || !rollup.rows.length) return out;

  const base = ctx?.baselineProbability;
  const fin  = ctx?.finalProbability;
  const lift = Number.isFinite(base) && Number.isFinite(fin) ? (fin - base) : null;

  const big = rollup.rows.filter(r => r.valuePct >= 76);
  if (big.length && Number.isFinite(lift) && _pb_pct(lift) <= 3) {
    out.push({
      pattern: 'High slider settings with minimal improvement',
      because: 'Multiple sliders in the 76–100 band but the final probability barely moved.',
      suggest: 'Revisit priors and confirm levers truly influence τ, or lower expectations/redistribute to capacity/process.'
    });
  }

  if (rollup.dominantNegative && Number.isFinite(ctx?.lambda) && ctx.lambda >= 0.8) {
    out.push({
      pattern: `Projection overshadowed a negative driver (${rollup.dominantNegative.name})`,
      because: 'A strong projection blend (λ≥0.8) can mask specific counter-forces at τ.',
      suggest: 'Reduce projection strength or mitigate the negative driver directly.'
    });
  }

  const risk = rollup.rows.find(r => /risk/i.test(r.name));
  if (risk && risk.valuePct >= 76 && Number.isFinite(lift) && _pb_pct(lift) < 5) {
    out.push({
      pattern: 'High risk tolerance with limited pay-off',
      because: 'Risk↑ expected bigger right-tail gains at τ; lift < 5 pts indicates weak coupling.',
      suggest: 'Audit tail-shave/left-shift parameters; consider scope or schedule levers instead.'
    });
  }

  const scopeCert = rollup.rows.find(r => /scope.?cert/i.test(r.name));
  const scopeRed  = rollup.rows.find(r => /scope.?red/i.test(r.name));
  if (scopeCert && scopeCert.valuePct >= 51 && scopeRed && scopeRed.valuePct === 0) {
    out.push({
      pattern: 'High Scope Certainty with Zero Scope Reduction',
      because: 'Locking scope without any reduction option can conflict with schedule/budget targets.',
      suggest: 'Introduce a small scope-reduction allowance (e.g., 10–20%) or confirm non-negotiables.'
    });
  }

  const rework = rollup.rows.find(r => /rework/i.test(r.name));
  const procTotals = (rollup.catTotals.process || 0);
  if (rework && rework.delta < 0 && Math.abs(rework.delta) > Math.abs(procTotals)) {
    out.push({
      pattern: 'Rework dominates but process discipline is not prioritized',
      because: 'Negative impact from Rework exceeds improvements from process levers.',
      suggest: 'Increase process/quality gates, pair-programming, or CI checks to suppress rework variance.'
    });
  }

  if (ctx?.explain?.mode?.includes('adaptive') && ctx.explain.chainingDrift > 5) {
    out.push({
      pattern: 'Adaptive chaining drift exceeds 5%',
      because: 'Seed from Fixed halved by dampen=0.5; trapped low-local min (ρ=0.6 over-shrink).',
      suggest: 'Patch to dampen=1 seeded, ρ=0.7 probe>2; re-run for +62pts lift fidelity.'
    });
  }

  return out;
}

function recommendationsBlock(ctx, rollup) {
  const recs = [];
  if (!rollup || !rollup.rows.length) return recs;

  const base = ctx?.baselineProbability;
  const fin  = ctx?.finalProbability;
  const lift = Number.isFinite(base) && Number.isFinite(fin) ? (fin - base) : 0;

  if (_pb_pct(lift) < 5) {
    recs.push('Raise capacity/process levers first (staffing, automation, QA gates) before fine-tuning behavioral knobs.');
  }

  if (ctx?.explain?.cv > 0.5) {
    recs.push('High CV: Prioritize certainty/tail-shave via adaptive mode. [PMBOK Ch.6: KL<0.05, erf-slack feas]');
  }

  if (Number.isFinite(ctx?.lambda) && ctx.lambda > 0.8) {
    recs.push('Consider lowering projection guard λ to expose real variance and avoid masking weak drivers.');
  }

  const cats = rollup.catTotals;
  const zeroBand = rollup.rows.filter(r => r.band === 'Zero');
  zeroBand.forEach(r => {
    if ((cats[r.category] || 0) < 0) {
      recs.push(`Increase "${r.name}" from Zero; its category "${r.category}" currently drags τ.`);
    }
  });

  const scopeCert = rollup.rows.find(r => /scope.?cert/i.test(r.name));
  const schedule  = rollup.rows.find(r => /sched/i.test(r.name));
  const budget    = rollup.rows.find(r => /budget/i.test(r.name));
  if (scopeCert && scopeCert.valuePct >= 51 && ((schedule && schedule.valuePct >= 51) || (budget && budget.valuePct >= 51))) {
    recs.push('Introduce 10–20% scope reduction buffer to protect schedule/budget while retaining core value.');
  }

  const rework = rollup.rows.find(r => /rework/i.test(r.name));
  if (rework && rework.valuePct >= 26) {
    recs.push('Tackle rework explicitly: pre-merge checks, test coverage targets, Definition-of-Done upgrades, and root-cause audits.');
  }

  if (Number.isFinite(ctx?.lambda) && ctx.lambda <= 0.4) {
    const risk = rollup.rows.find(r => /risk/i.test(r.name));
    if (risk && risk.valuePct >= 51) {
      recs.push('Slightly increase projection λ to stabilize tails while maintaining upside from higher risk tolerance.');
    }
  }

  if (ctx?.explain?.mode?.includes('adaptive') && ctx.explain.probeLevel <= 2) {
    recs.push('Probe=3+: Enable deeper adaptive refine (maxIter=100, ρ=0.7) for +2pts lift over Fixed seed.');
  }

  return recs;
}

function narrativeLine(ctx, rollup) {
  const base = Number.isFinite(ctx?.baselineProbability) ? round(_pb_pct(ctx.baselineProbability), 2) : null;
  const fin  = Number.isFinite(ctx?.finalProbability) ? round(_pb_pct(ctx.finalProbability), 2) : null;
  const lift = (base != null && fin != null) ? round(fin - base, 2) : null;
  const lam  = Number.isFinite(ctx?.lambda) ? round(ctx.lambda, 4) : null;

  const pieces = [];
  pieces.push(`${ctx.mode} result at τ${ctx.target != null ? `=${round(ctx.target,3)}` : ''}:`);
  pieces.push(`Baseline ${base != null ? base + '%' : '–'} → Final ${fin != null ? fin + '%' : '–'}`);
  if (lift != null) pieces.push(`(Δ=${lift} pts)`);
  if (lam != null) pieces.push(`with λ=${lam}`);
  const top = rollup?.top3 || [];
  if (top.length) {
    pieces.push(`; key drivers: ${top.map(r => `${r.name}(${r.band})`).join(', ')}`);
  }
  if (ctx?.explain?.mode?.includes('adaptive')) {
    pieces.push(`; chained from Fixed (drift=${ctx.explain.chainingDrift || 'N/A'}%)`);
  }
  return pieces.join(' ');
}

function runPlaybooks(ctx) {
  const explain = ctx?.explain || null;
  const rollup = summarizeSliders(explain?.sliders || []);

  return {
    diagnostics: diagnosticsBlock(ctx, rollup),
    counterIntuition: counterIntuitionBlock(ctx, rollup),
    recommendations: recommendationsBlock(ctx, rollup),
    bands: rollup.bands,
    sliderCategories: rollup.sliderCategories,
    winningSliders: rollup.winning,
    narrative: narrativeLine(ctx, rollup)
  };
}
