/* ProjectCare by iCareNOW — plot.js
 * Handles: URL parsing, data decoding, all chart rendering,
 * live polling, browser-side slider re-computation.
 */
var PlotApp = (function () {
  'use strict';

  // ── Constants ────────────────────────────────────────────────────────────────
  var WP_BASE        = 'https://icarenow.io';
  var POLL_MS        = 3000;
  var POLL_RETRY_MS  = 10000;
  var MAX_FAILURES   = 3;
  var SLIDER_KEYS    = ['budgetFlexibility','scheduleFlexibility','scopeCertainty',
                        'scopeReductionAllowance','reworkPercentage','riskTolerance','userConfidence'];
  var SLIDER_DEFAULTS = {
    budgetFlexibility: 50, scheduleFlexibility: 50, scopeCertainty: 50,
    scopeReductionAllowance: 50, reworkPercentage: 25, riskTolerance: 50, userConfidence: 75
  };
  var SERIES_CFG = [
    { key:'base', label:'Baseline',  color:'#10B981', dash:false, fill:true },
    { key:'adj',  label:'Adjusted',  color:'#059669', dash:true,  fill:false },
    { key:'opt',  label:'SACO',      color:'#6D28D9', dash:false, fill:true },
    { key:'tri',  label:'Triangle',  color:'#3B82F6', dash:true,  fill:false },
    { key:'pert', label:'PERT',      color:'#7C3AED', dash:true,  fill:false }
  ];

  // ── State ────────────────────────────────────────────────────────────────────
  var S = {
    source:       null,   // last data object from URL or poll
    current:      null,   // currently displayed (may differ when sliders dragged)
    isCustom:     false,  // true when user has moved a slider
    pendingUpdate: null,  // new data waiting for user to apply
    task:         null,   // { name, O, M, P, target }
    sliders:      Object.assign({}, SLIDER_DEFAULTS),
    seriesOn:     { base:true, adj:true, opt:true, tri:false, pert:false },
    distTab:      'pdf',
    pollToken:    null,
    pollTimer:    null,
    failCount:    0,
    lastSavedAt:  null,
    charts:       {}      // { pdf, cdf, tornado, radar }
  };

  // ── URL Parsing ───────────────────────────────────────────────────────────────
  function parseUrlParams() {
    var params = {};
    var search = window.location.search.substring(1);
    search.split('&').forEach(function (pair) {
      var idx = pair.indexOf('=');
      if (idx > 0) params[decodeURIComponent(pair.slice(0, idx))] = decodeURIComponent(pair.slice(idx + 1));
    });
    return params;
  }

  function decodeDataParam(b64) {
    try {
      return JSON.parse(atob(b64));
    } catch (e) {
      console.error('[PMC plot] Failed to decode data param:', e);
      return null;
    }
  }

  // ── Live Badge ───────────────────────────────────────────────────────────────
  function setLiveBadge(state, label) {
    var dot  = document.getElementById('pmc-live-dot');
    var lbl  = document.getElementById('pmc-live-label');
    if (!dot || !lbl) return;
    dot.className = 'live-dot ' + (state || '');
    lbl.textContent = label || 'Static';
  }

  // ── Polling ───────────────────────────────────────────────────────────────────
  function startPolling(token) {
    S.pollToken = token;
    setLiveBadge('active', 'Live');
    schedulePoll(0);
  }

  function schedulePoll(delay) {
    clearTimeout(S.pollTimer);
    S.pollTimer = setTimeout(doPoll, delay);
  }

  function doPoll() {
    if (!S.pollToken) return;
    fetch(WP_BASE + '/wp-json/projectcare/v1/plot-data/' + S.pollToken, {
      method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store'
    })
    .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
    .then(function (payload) {
      S.failCount = 0;
      setLiveBadge('active', 'Live');
      if (payload.status === 'not_found') { schedulePoll(POLL_MS); return; }
      if (payload.data && payload.saved_at && payload.saved_at !== S.lastSavedAt) {
        applyPollPayload(payload);
      }
      schedulePoll(POLL_MS);
    })
    .catch(function () {
      S.failCount++;
      if (S.failCount >= MAX_FAILURES) setLiveBadge('error', 'Paused');
      schedulePoll(S.failCount >= MAX_FAILURES ? POLL_RETRY_MS : POLL_MS);
    });
  }

  function applyPollPayload(payload) {
    var newData = payload.data;
    S.lastSavedAt = payload.saved_at;
    if (S.isCustom) {
      // User has modified sliders — don't override; show banner
      S.pendingUpdate = newData;
      showUpdateBanner();
      return;
    }
    animatedUpdate(newData);
  }

  function showUpdateBanner() {
    var el = document.getElementById('pmc-update-banner');
    if (el) el.style.display = 'block';
  }

  function hideUpdateBanner() {
    var el = document.getElementById('pmc-update-banner');
    if (el) el.style.display = 'none';
  }

  // ── Animated Update ──────────────────────────────────────────────────────────
  function animatedUpdate(data) {
    var main = document.getElementById('pmc-main');
    if (!main) { renderAll(data); return; }
    main.classList.add('pmc-fading');
    setTimeout(function () {
      renderAll(data);
      main.classList.remove('pmc-fading');
      main.classList.add('pmc-visible');
    }, 300);
  }

  // ── Master Render ────────────────────────────────────────────────────────────
  function renderAll(data) {
    if (!data) return;
    S.source  = data;
    S.current = data;
    extractTask(data);
    syncSlidersFromData(data);

    renderHeader(data);
    renderProbabilityTrio(data);
    renderDistributionCharts(data);
    render3DSurface(data);
    renderTornadoChart(data);
    renderPercentileTable(data);
    renderRadarChart(data);
    renderScenarioTable(data);
    renderDecisionNarrative(data);
    renderPortfolioBlock(data);

    document.getElementById('pmc-skeleton').classList.add('pmc-hidden');
    document.getElementById('pmc-main').classList.remove('pmc-hidden');
    setLiveBadge(S.pollToken ? 'active' : '', S.pollToken ? 'Live' : 'Static');
  }

  function extractTask(data) {
    S.task = {
      name:   data.taskName || 'Estimation',
      O:      data.O, M: data.M, P: data.P,
      target: data.target != null ? data.target : null
    };
  }

  function syncSlidersFromData(data) {
    if (!data.winningSliders) return;
    SLIDER_KEYS.forEach(function (k) {
      if (data.winningSliders[k] != null) S.sliders[k] = data.winningSliders[k];
    });
    applySliderDOM();
    S.isCustom = false;
    hideUpdateBanner();
  }

  // ── Header ────────────────────────────────────────────────────────────────────
  function renderHeader(data) {
    var el = document.getElementById('pmc-task-title');
    if (el) el.textContent = data.taskName || 'Estimation';

    var omp = document.getElementById('pmc-omp');
    if (omp && data.O != null) {
      omp.textContent = 'O: ' + fmt(data.O) + '  M: ' + fmt(data.M) + '  P: ' + fmt(data.P)
        + (data.target != null ? '  Target: ' + fmt(data.target) : '');
    }

    var badge = document.getElementById('pmc-feasibility-badge');
    if (badge) {
      var score = data.feasibilityScore;
      if (score == null) { badge.textContent = '–'; badge.className = 'pmc-feasibility-badge badge-grey'; }
      else {
        badge.textContent = 'Feasibility ' + score + '/100';
        badge.className   = 'pmc-feasibility-badge ' +
          (score >= 70 ? 'badge-green' : score >= 50 ? 'badge-amber' : 'badge-red');
      }
    }
  }

  // ── Probability Trio ─────────────────────────────────────────────────────────
  function renderProbabilityTrio(data) {
    var tp = (data.targetProbability) || {};
    var orig = tp.original          != null ? tp.original          : null;
    var adj  = tp.adjusted          != null ? tp.adjusted          : null;
    var opt  = tp.adjustedOptimized != null ? tp.adjustedOptimized
             : tp.adaptiveOptimized != null ? tp.adaptiveOptimized : null;

    var card = document.getElementById('pmc-prob-card');
    if (orig == null && adj == null && opt == null) { if (card) card.classList.add('pmc-hidden'); return; }
    if (card) card.classList.remove('pmc-hidden');

    setTrio('trio-base', 'trio-base-delta', orig, null);
    setTrio('trio-adj',  'trio-adj-delta',  adj,  orig);
    setTrio('trio-opt',  'trio-opt-delta',  opt,  orig);
  }

  function setTrio(valId, deltaId, prob, base) {
    var vEl = document.getElementById(valId);
    var dEl = document.getElementById(deltaId);
    if (!vEl) return;
    if (prob == null) { vEl.textContent = '–'; if (dEl) dEl.textContent = ''; return; }
    vEl.textContent = Math.round(prob * 100) + '%';
    if (dEl && base != null) {
      var diff = Math.round((prob - base) * 100);
      dEl.textContent = (diff >= 0 ? '+' : '') + diff + ' pts';
      dEl.className   = 'trio-delta ' + (diff >= 0 ? 'pos' : 'neg');
    }
  }

  // ── Distribution Charts (PDF + CDF) ─────────────────────────────────────────
  function renderDistributionCharts(data) {
    buildSeriesToggleUI(data);
    buildDistChart('pdf', data);
    buildDistChart('cdf', data);
  }

  function buildSeriesToggleUI(data) {
    var cont = document.getElementById('pmc-series-toggles');
    if (!cont) return;
    cont.innerHTML = '';
    SERIES_CFG.forEach(function (cfg) {
      var hasData = getPoints(data, cfg.key, 'pdf').length > 0;
      if (!hasData) return;
      var label = document.createElement('label');
      label.className = 'series-toggle';
      var cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = S.seriesOn[cfg.key];
      cb.onchange = function () {
        S.seriesOn[cfg.key] = cb.checked;
        buildDistChart('pdf', S.current);
        buildDistChart('cdf', S.current);
      };
      var swatch = document.createElement('span');
      swatch.className = 'series-swatch';
      swatch.style.background = cfg.color;
      label.appendChild(cb); label.appendChild(swatch);
      label.appendChild(document.createTextNode(' ' + cfg.label));
      cont.appendChild(label);
    });
  }

  function getPoints(data, seriesKey, pdfOrCdf) {
    var k = seriesKey + (pdfOrCdf === 'pdf' ? 'Pdf' : 'Cdf');
    return Array.isArray(data[k]) ? data[k] : [];
  }

  function buildDistChart(type, data) {
    var canvasId = type === 'pdf' ? 'pmc-pdf-chart' : 'pmc-cdf-chart';
    var chartKey = type === 'pdf' ? 'pdf' : 'cdf';
    var canvas   = document.getElementById(canvasId);
    if (!canvas) return;

    if (S.charts[chartKey]) { S.charts[chartKey].destroy(); S.charts[chartKey] = null; }

    var datasets = [];
    SERIES_CFG.forEach(function (cfg) {
      if (!S.seriesOn[cfg.key]) return;
      var pts = getPoints(data, cfg.key, type);
      if (!pts.length) return;
      var sampled = sampleEvery(pts, 80);
      datasets.push({
        label:           cfg.label,
        data:            sampled,
        parsing:         { xAxisKey: 'x', yAxisKey: 'y' },
        borderColor:     cfg.color,
        backgroundColor: cfg.fill ? hexAlpha(cfg.color, 0.12) : 'transparent',
        fill:            cfg.fill ? 'origin' : false,
        tension:         0.4,
        pointRadius:     0,
        borderDash:      cfg.dash ? [4, 3] : [],
        borderWidth:     cfg.fill ? 2 : 1.5
      });
    });

    var annotations = {};
    if (data.target != null && type === 'pdf') {
      annotations.target = {
        type: 'line', xMin: data.target, xMax: data.target,
        borderColor: '#F59E0B', borderWidth: 1.5, borderDash: [6, 3],
        label: { display: true, content: 'Target', position: 'start',
                 backgroundColor: '#fef3c7', color: '#92400e', font: { size: 10 } }
      };
    }

    S.charts[chartKey] = new Chart(canvas, {
      type: 'line',
      data: { datasets: datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } },
          annotation: { annotations: annotations }
        },
        scales: {
          x: { type: 'linear', title: { display: true, text: S.task ? S.task.name : 'Value', font: { size: 11 } } },
          y: { title: { display: true, text: type === 'pdf' ? 'Density' : 'Probability', font: { size: 11 } },
               min: 0, max: type === 'cdf' ? 1 : undefined }
        }
      }
    });
  }

  // ── Switch Distribution Tab ──────────────────────────────────────────────────
  function switchDistTab(tab) {
    S.distTab = tab;
    document.getElementById('tab-pdf').classList.toggle('active', tab === 'pdf');
    document.getElementById('tab-cdf').classList.toggle('active', tab === 'cdf');
    document.getElementById('pmc-pdf-wrap').classList.toggle('pmc-hidden', tab !== 'pdf');
    document.getElementById('pmc-cdf-wrap').classList.toggle('pmc-hidden', tab !== 'cdf');
  }

  // ── 3D Surface (Plotly) ──────────────────────────────────────────────────────
  function render3DSurface(data) {
    var div = document.getElementById('pmc-3d-surface');
    if (!div) return;

    var base = sampleEvery(data.basePdf || [], 50);
    var adj  = sampleEvery(data.adjPdf  || [], 50);
    var opt  = sampleEvery(data.optPdf  || [], 50);

    // Need at least baseline
    if (!base.length) { div.innerHTML = '<p style="padding:40px;text-align:center;color:#9ca3af">No distribution data</p>'; return; }

    // Align to common x-grid from baseline
    var xVals  = base.map(function (p) { return p.x; });
    var yBase  = base.map(function (p) { return p.y; });
    var yAdj   = adj.length  ? interpolateToX(adj,  xVals) : yBase.map(function () { return 0; });
    var yOpt   = opt.length  ? interpolateToX(opt,  xVals) : yBase.map(function () { return 0; });

    var traces = [{
      type: 'surface',
      x: xVals,
      y: [0, 1, 2],
      z: [yBase, yAdj, yOpt],
      colorscale: 'Viridis',
      opacity: 0.88,
      contours: { z: { show: true, usecolormap: true, project: { z: true } } },
      showscale: false,
      name: 'Distribution'
    }];

    // Target plane
    if (data.target != null) {
      var tIdx   = xVals.reduce(function (best, x, i) { return Math.abs(x - data.target) < Math.abs(xVals[best] - data.target) ? i : best; }, 0);
      var maxDen = Math.max.apply(null, yBase.concat(yAdj).concat(yOpt));
      traces.push({
        type: 'scatter3d', mode: 'lines',
        x: [xVals[tIdx], xVals[tIdx], xVals[tIdx]],
        y: [0, 1, 2],
        z: [maxDen, maxDen, maxDen],
        line: { color: '#F59E0B', width: 4 },
        name: 'Target'
      });
    }

    Plotly.newPlot(div, traces, {
      margin: { t: 10, l: 10, r: 10, b: 10 },
      scene: {
        xaxis: { title: { text: (S.task && S.task.name) || 'Value' } },
        yaxis: { title: { text: 'Mode' }, tickvals: [0, 1, 2], ticktext: ['Baseline', 'Adjusted', 'SACO'] },
        zaxis: { title: { text: 'Density' } },
        camera: { eye: { x: 1.5, y: -1.8, z: 1.2 } }
      }
    }, { responsive: true, displayModeBar: false });
  }

  function interpolateToX(pts, xVals) {
    return xVals.map(function (x) {
      if (!pts.length) return 0;
      if (x <= pts[0].x)          return pts[0].y;
      if (x >= pts[pts.length-1].x) return pts[pts.length-1].y;
      for (var i = 1; i < pts.length; i++) {
        if (pts[i].x >= x) {
          var t = (x - pts[i-1].x) / (pts[i].x - pts[i-1].x);
          return pts[i-1].y + t * (pts[i].y - pts[i-1].y);
        }
      }
      return 0;
    });
  }

  // ── Tornado Chart ────────────────────────────────────────────────────────────
  function renderTornadoChart(data) {
    var canvas = document.getElementById('pmc-tornado-chart');
    if (!canvas) return;
    if (S.charts.tornado) { S.charts.tornado.destroy(); S.charts.tornado = null; }

    var sens = data.sensitivity;
    if (!sens || !Array.isArray(sens.sliders) || !sens.sliders.length) {
      canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    var sorted = sens.sliders.slice().sort(function (a, b) { return Math.abs(b.gain) - Math.abs(a.gain); });
    var labels = sorted.map(function (s) { return shortSliderName(s.slider) + ' (' + Math.round(S.sliders[s.slider] || 0) + ')'; });
    var gains  = sorted.map(function (s) { return Math.round((s.gain || 0) * 1000) / 10; }); // per 10-unit
    var colors = sorted.map(function (s) { return (s.gain || 0) >= 0 ? '#10B981' : '#EF4444'; });

    S.charts.tornado = new Chart(canvas, {
      type: 'bar',
      data: { labels: labels, datasets: [{ data: gains, backgroundColor: colors, borderRadius: 3 }] },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: function (ctx) { return (ctx.parsed.x >= 0 ? '+' : '') + ctx.parsed.x.toFixed(1) + '% per 10-unit increase'; } } }
        },
        scales: {
          x: { title: { display: true, text: 'Δ P(≤ Target) per 10-unit increase (%)', font: { size: 10 } } },
          y: { ticks: { font: { size: 10 } } }
        }
      }
    });
  }

  // ── Percentile Table ─────────────────────────────────────────────────────────
  function renderPercentileTable(data) {
    var tbody = document.getElementById('pmc-pct-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    var keys = ['p5','p10','p20','p30','p40','p50','p60','p70','p80','p90','p95'];
    var base = data.percentiles || {};
    var opt  = data.optimizedPercentiles || {};

    var rowBase = document.createElement('tr');
    rowBase.innerHTML = '<td class="row-label">Baseline</td>' +
      keys.map(function (k) { return '<td>' + (base[k] != null ? fmt(base[k]) : '–') + '</td>'; }).join('');
    tbody.appendChild(rowBase);

    if (Object.keys(opt).length) {
      // Map opt keys: p10, p50, p90 only
      var rowOpt = document.createElement('tr');
      rowOpt.innerHTML = '<td class="row-label">SACO</td>' +
        keys.map(function (k) {
          var bv = base[k], ov = opt[k];
          if (ov == null) return '<td>–</td>';
          var cls = bv != null ? (ov < bv ? 'pct-better' : ov > bv ? 'pct-worse' : '') : '';
          return '<td class="' + cls + '">' + fmt(ov) + '</td>';
        }).join('');
      tbody.appendChild(rowOpt);
    }
  }

  // ── Radar Chart ──────────────────────────────────────────────────────────────
  function renderRadarChart(data) {
    var canvas = document.getElementById('pmc-radar-chart');
    if (!canvas) return;
    if (S.charts.radar) { S.charts.radar.destroy(); S.charts.radar = null; }

    var win = data.winningSliders || {};
    var labels = SLIDER_KEYS.map(shortSliderName);

    // Normalize: reworkPercentage max=50 → scale to 100 for radar
    function normalize(key, val) {
      if (val == null) return 0;
      return key === 'reworkPercentage' ? Math.round(val * 2) : val;
    }

    var sacaVals = SLIDER_KEYS.map(function (k) { return normalize(k, win[k] != null ? win[k] : S.sliders[k]); });
    var userVals = SLIDER_KEYS.map(function (k) { return normalize(k, S.sliders[k]); });

    var datasets = [
      { label: 'SACO Optimal', data: sacaVals,
        backgroundColor: 'rgba(109,40,217,0.15)', borderColor: '#6D28D9', pointRadius: 3 },
      { label: 'Your Input',   data: userVals,
        backgroundColor: 'rgba(16,185,129,0.12)', borderColor: '#10B981', pointRadius: 3, borderDash: [4,3] }
    ];

    S.charts.radar = new Chart(canvas, {
      type: 'radar',
      data: { labels: labels, datasets: datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: { r: { min: 0, max: 100, ticks: { font: { size: 9 } }, pointLabels: { font: { size: 10 } } } },
        plugins: { legend: { position: 'top', labels: { boxWidth: 10, font: { size: 10 } } } }
      }
    });
  }

  // ── Scenario Table ────────────────────────────────────────────────────────────
  function renderScenarioTable(data) {
    var card  = document.getElementById('pmc-scenario-card');
    var tbody = document.getElementById('pmc-scenario-tbody');
    if (!card || !tbody) return;

    var scenarios = data.scenarios;
    if (!Array.isArray(scenarios) || !scenarios.length) { card.classList.add('pmc-hidden'); return; }
    card.classList.remove('pmc-hidden');

    var baseProb = (data.targetProbability && data.targetProbability.original) || null;
    tbody.innerHTML = scenarios.map(function (s) {
      var prob  = s.probability != null ? Math.round(s.probability * 100) + '%' : '–';
      var delta = (s.probability != null && baseProb != null)
        ? Math.round((s.probability - baseProb) * 100) : null;
      var deltaHtml = delta != null
        ? '<span style="color:' + (delta >= 0 ? '#10B981' : '#EF4444') + '">' + (delta >= 0 ? '+' : '') + delta + ' pts</span>'
        : '–';
      return '<tr><td>' + esc(s.name) + '</td><td>' + (s.targetValue != null ? fmt(s.targetValue) : '–') +
             '</td><td>' + prob + '</td><td>' + deltaHtml + '</td></tr>';
    }).join('');
  }

  // ── Decision Narrative ────────────────────────────────────────────────────────
  function renderDecisionNarrative(data) {
    var card = document.getElementById('pmc-decision-card');
    var recs  = data.recommendations    || [];
    var ci    = data.counterIntuition   || [];
    var narr  = data.narrative          || '';
    if (!card) return;
    if (!recs.length && !ci.length && !narr) { card.classList.add('pmc-hidden'); return; }
    card.classList.remove('pmc-hidden');

    var recList = document.getElementById('pmc-recommendations-list');
    if (recList) {
      recList.innerHTML = recs.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('');
    }

    var ciList = document.getElementById('pmc-counter-intuition-list');
    if (ciList) {
      ciList.innerHTML = ci.map(function (c) {
        return '<li><strong>' + esc(c.pattern || '') + '</strong><br>' +
               esc(c.because || '') + (c.suggest ? '<br><em>' + esc(c.suggest) + '</em>' : '') + '</li>';
      }).join('');
    }

    var narrEl = document.getElementById('pmc-narrative-text');
    if (narrEl) narrEl.textContent = narr;
  }

  // ── Portfolio Block ───────────────────────────────────────────────────────────
  function renderPortfolioBlock(data) {
    var card = document.getElementById('pmc-portfolio-card');
    var bar  = document.getElementById('pmc-portfolio-bar');
    if (!card || !bar) return;
    var p = data.portfolio;
    if (!p || p.p50 == null) { card.classList.add('pmc-hidden'); return; }
    card.classList.remove('pmc-hidden');

    bar.innerHTML = [
      ['P10', p.p10], ['P50 (Median)', p.p50], ['P90', p.p90]
    ].map(function (pair) {
      return '<div class="port-stat"><div class="port-label">' + pair[0] + '</div>' +
             '<div class="port-val">' + (pair[1] != null ? fmt(pair[1]) : '–') + '</div></div>';
    }).join('') +
    '<div style="font-size:11px;color:var(--muted);align-self:flex-end;margin-left:12px">' +
    esc(p.method === 'pert_critical_path' ? 'Critical path' : 'Sequential sum') +
    ' · ' + (p.taskCount || '?') + ' tasks</div>';
  }

  // ── Slider Interaction ───────────────────────────────────────────────────────
  var _sliderDebounce = null;

  function onSlider(key, val) {
    val = parseFloat(val);
    S.sliders[key] = val;
    S.isCustom = true;
    // Update display value
    var idMap = {
      budgetFlexibility:'sv-budget', scheduleFlexibility:'sv-schedule', scopeCertainty:'sv-scopecert',
      scopeReductionAllowance:'sv-scopered', reworkPercentage:'sv-rework', riskTolerance:'sv-risk',
      userConfidence:'sv-userconf'
    };
    var el = document.getElementById(idMap[key]);
    if (el) el.textContent = val;

    clearTimeout(_sliderDebounce);
    _sliderDebounce = setTimeout(runAdjustedCompute, 150);
  }

  function runAdjustedCompute() {
    if (!S.task || !window.PMCCopula) return;
    try {
      // Run adjusted path only (fast copula reshape, no optimizer)
      var baseData  = S.current || S.source;
      var basePdf   = (baseData && baseData.basePdf) || [];
      var baseCdf   = (baseData && baseData.baseCdf) || [];
      if (!basePdf.length) return;

      var basePoints = { pdfPoints: basePdf, cdfPoints: baseCdf };
      var adjRes = window.PMCCopula.computeSliderProbability({
        points:      basePoints,
        optimistic:  S.task.O,
        mostLikely:  S.task.M,
        pessimistic: S.task.P,
        targetValue: S.task.target != null ? S.task.target : S.task.M,
        sliderValues: S.sliders,
        probeLevel:  1
      });

      // Merge into current display without overwriting source
      var merged = Object.assign({}, S.current || S.source);
      if (adjRes && adjRes.reshapedPoints) {
        merged.adjPdf = adjRes.reshapedPoints.pdfPoints || [];
        merged.adjCdf = adjRes.reshapedPoints.cdfPoints || [];
      }
      if (adjRes && adjRes.probability) {
        var tp = Object.assign({}, merged.targetProbability || {});
        tp.adjusted = adjRes.probability.value;
        merged.targetProbability = tp;
      }
      S.current = merged;
      buildDistChart('pdf', merged);
      buildDistChart('cdf', merged);
      renderProbabilityTrio(merged);
      renderRadarChart(merged);
    } catch (e) {
      console.error('[PMC plot] Adjusted compute error:', e);
    }
  }

  function recomputeSACO() {
    if (!S.task || !window.PMCSACO) return;
    var btn    = document.getElementById('pmc-recompute-btn');
    var status = document.getElementById('pmc-recompute-status');
    if (btn) btn.disabled = true;
    if (status) status.textContent = 'Running SACO optimizer…';

    setTimeout(function () {
      try {
        var result = window.PMCSACO.run({
          task:         S.task.name,
          optimistic:   S.task.O,
          mostLikely:   S.task.M,
          pessimistic:  S.task.P,
          targetValue:  S.task.target,
          sliderValues: S.sliders,
          probeLevel:   5
        });

        // Rebuild a plotData-like object from the SACO result
        var rr = result;
        var merged = Object.assign({}, S.source || {});
        merged.basePdf = safeGet(rr,'baseline','monteCarloSmoothed','pdfPoints') || merged.basePdf;
        merged.baseCdf = safeGet(rr,'baseline','monteCarloSmoothed','cdfPoints') || merged.baseCdf;
        merged.adjPdf  = safeGet(rr,'adjusted','reshapedPoints','pdfPoints') || [];
        merged.adjCdf  = safeGet(rr,'adjusted','reshapedPoints','cdfPoints') || [];
        merged.optPdf  = safeGet(rr,'optimize','reshapedPoints','pdfPoints') || [];
        merged.optCdf  = safeGet(rr,'optimize','reshapedPoints','cdfPoints') || [];
        merged.targetProbability = (rr.targetProbability && rr.targetProbability.value) || {};
        if (rr.optimize && rr.optimize.sliders) merged.winningSliders = rr.optimize.sliders;
        S.current = merged;

        renderDistributionCharts(merged);
        renderProbabilityTrio(merged);
        renderRadarChart(merged);
        render3DSurface(merged);

        if (status) status.textContent = 'Done.';
        setTimeout(function () { if (status) status.textContent = ''; }, 2000);
      } catch (e) {
        console.error('[PMC plot] SACO recompute error:', e);
        if (status) status.textContent = 'Error: ' + e.message;
      }
      if (btn) btn.disabled = false;
    }, 10);
  }

  function resetToSACO() {
    if (!S.source) return;
    S.isCustom = false;
    S.current  = S.source;
    syncSlidersFromData(S.source);
    renderAll(S.source);
    hideUpdateBanner();
  }

  function applySliderDOM() {
    var idMap = {
      budgetFlexibility:'sl-budget', scheduleFlexibility:'sl-schedule', scopeCertainty:'sl-scopecert',
      scopeReductionAllowance:'sl-scopered', reworkPercentage:'sl-rework', riskTolerance:'sl-risk',
      userConfidence:'sl-userconf'
    };
    var valMap = {
      budgetFlexibility:'sv-budget', scheduleFlexibility:'sv-schedule', scopeCertainty:'sv-scopecert',
      scopeReductionAllowance:'sv-scopered', reworkPercentage:'sv-rework', riskTolerance:'sv-risk',
      userConfidence:'sv-userconf'
    };
    SLIDER_KEYS.forEach(function (k) {
      var el = document.getElementById(idMap[k]);
      var ve = document.getElementById(valMap[k]);
      var v  = S.sliders[k];
      if (el) el.value = v;
      if (ve) ve.textContent = v;
    });
  }

  // ── Utility ──────────────────────────────────────────────────────────────────
  function sampleEvery(arr, maxPts) {
    if (!arr || !arr.length || arr.length <= maxPts) return arr || [];
    var step = Math.ceil(arr.length / maxPts);
    var out  = [];
    for (var i = 0; i < arr.length; i += step) out.push(arr[i]);
    return out;
  }

  function hexAlpha(hex, a) {
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  function fmt(n) {
    if (n == null) return '–';
    return Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function shortSliderName(key) {
    var map = {
      budgetFlexibility:'Budget', scheduleFlexibility:'Schedule', scopeCertainty:'Scope Cert.',
      scopeReductionAllowance:'Scope Red.', reworkPercentage:'Rework', riskTolerance:'Risk', userConfidence:'Confidence'
    };
    return map[key] || key;
  }

  function safeGet(obj, a, b, c) {
    try { return obj[a][b][c]; } catch(e) { return null; }
  }

  // ── Init ─────────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    Chart.register(window['chartjs-plugin-annotation']);

    var params = parseUrlParams();
    var dataB64 = params.data;
    var token   = params.session;

    // Apply update banner listener
    var applyBtn = document.getElementById('pmc-apply-update');
    if (applyBtn) {
      applyBtn.addEventListener('click', function () {
        if (S.pendingUpdate) { animatedUpdate(S.pendingUpdate); S.pendingUpdate = null; }
        hideUpdateBanner();
      });
    }

    if (!dataB64 && !token) {
      // No params — show a usage hint
      var sk = document.getElementById('pmc-skeleton');
      if (sk) { sk.classList.remove('pmc-hidden'); sk.innerHTML = '<p>No data provided. Open this page via a ChatGPT estimation link.</p>'; }
      return;
    }

    if (dataB64) {
      // Mode A or C: render immediately from data param (scalars only)
      var slim = decodeDataParam(dataB64);
      if (slim) {
        // Show what we have immediately (KPIs + percentiles work without arrays)
        renderAll(slim);
      }
    } else {
      // Mode B: session-only — show skeleton while waiting
      var sk2 = document.getElementById('pmc-skeleton');
      if (sk2) sk2.classList.remove('pmc-hidden');
    }

    // Start polling if session token present (Modes B and C)
    if (token) {
      startPolling(token);
    } else {
      setLiveBadge('', 'Static');
    }
  });

  // Public API
  return {
    switchDistTab: switchDistTab,
    onSlider:      onSlider,
    recomputeSACO: recomputeSACO,
    resetToSACO:   resetToSACO
  };

})();
