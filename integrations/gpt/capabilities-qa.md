# ProjectCare by iCareNOW GPT — Capabilities & Q&A Reference

**Purpose:** Internal reference for GPT reasoning. Verified against openapi.yaml, instructions.md, main.gs, webapp.gs, cpm-engine.gs, stochastic-cpm.gs, and cpm-adapter.gs. Do not invent fields beyond what is documented here.

---

## 1. How the Engine Works

### What SACO Is and What It Optimizes
SACO (Shape-Adaptive Copula Optimization) is a probability optimization engine that combines Beta-PERT distributions, Gaussian copula correlation modeling, and an LHS+COBYLA-lite optimizer. Given a task's O/M/P estimates and seven management context sliders, SACO searches the 7-dimensional slider space to find the slider configuration that maximizes P(X ≤ target) — the probability of finishing at or below the target value — subject to two regularization penalties: exp(−KL), which prevents the reshaped distribution from drifting too far from baseline, and exp(−leash), which keeps slider settings within plausible management range. When no target is provided, the optimizer uses the PERT mean as an internal fallback target so it still runs and still reshapes the distribution.

### What the Three Probability Outputs Mean
The API returns up to four probability values under `targetProbability.value`. **original** is the pure baseline probability — no slider input, no optimization, just the raw Beta-PERT/KDE distribution evaluated at the target. This is the project's inherent probability given only the O/M/P numbers. **adjusted** is the probability after applying the user's manually supplied `sliderValues` through the Gaussian copula reshape; it reflects the project context the user described. **adjustedOptimized** is the probability after SACO runs its fixed-probe optimization phase seeded from the user's sliders (or from defaults if none were provided). **adaptiveOptimized** is the probability after the adaptive optimizer phase. In practice, `adaptiveOptimized` may equal `adjustedOptimized` or exceed it. These four values form the "three-way comparison" table (baseline → user context → SACO optimal). Note: `adjusted` is only meaningful when the user supplied `sliderValues` AND a `targetValue`; if no sliders were provided, `adjusted` may echo baseline.

### How Targets Work
`targetValue` is optional but strongly recommended. When provided: the engine computes all four probability values (original, adjusted, adjustedOptimized, adaptiveOptimized), generates a `feasibilityScore` (0–100), and runs sensitivity analysis (which sliders have the most leverage). When omitted: no `targetProbability` block is returned, no `feasibilityScore` is produced, and sensitivity is skipped. The optimizer still runs internally (using pertMean as the fallback target) and still returns `optimizedPercentiles`, `decisionReports`, `winningSliders`, and `sliderDelta`. `confidenceTarget` is a separate mechanism: it returns the distribution value at a requested percentile (e.g., "what value gives 85% probability?") via `results[i].targetAtConfidence`.

### How Slider Values Affect Results
Sliders encode management context. They are input in UI units and passed to the Gaussian copula reshape function, which adjusts the Beta distribution's moments (mean shift, variance compression). The seven sliders and their UI ranges:
- `budgetFlexibility`: 0–100. Higher = more contingency reserves → reduces right-tail cost risk.
- `scheduleFlexibility`: 0–100. Higher = more timeline buffer → reduces schedule overrun probability.
- `scopeCertainty`: 0–100. Higher = locked requirements → reduces variance spread.
- `scopeReductionAllowance`: 0–100. Higher = ability to cut deliverables → improves target-hit probability.
- `reworkPercentage`: **0–50** (special domain, not 0–100). Higher = more rework cycles → increases mean and variance.
- `riskTolerance`: 0–100. Higher = team comfort with uncertainty → affects copula correlation weighting.
- `userConfidence`: 0–100. Higher = historically-grounded estimates → compresses distribution variance.

Default for any omitted slider is 50 (UI units). After SACO runs, `decisionReports[].winningSliders` returns the recommended UI-unit settings and `sliderDelta` shows the per-slider difference from the user's input.

---

## 2. Capabilities by Category

### A. Basic Estimation (O/M/P → Distribution + Percentiles)

**Q1: What is the P10, P50, and P90 for this task?**
- API fields: `results[i].percentiles.p10`, `.p50`, `.p90`
- Data path: GPT collects O/M/P → `call_api` with `tasks[{task, optimistic, mostLikely, pessimistic}]` → `results[0].percentiles` → GPT presents as "10th/50th/90th percentile outcomes"
- Status: ✅ FULL

**Q2: What is the full percentile table from P5 to P95?**
- API fields: `results[i].percentiles` (p5, p10, p20, p30, p40, p50, p60, p70, p80, p90, p95)
- Data path: Same call as Q1 → full `percentiles` object returned for `full_saco` and `saco_explain`
- Status: ✅ FULL

**Q3: What is the best-case outcome?**
- API fields: `results[i].percentiles.p10` (optimistic bound) and the input `optimistic` value
- Data path: P10 is the statistical best-case from the distribution; the raw `optimistic` input is the absolute floor
- Status: ✅ FULL

**Q4: What is the worst-case outcome I should plan for?**
- API fields: `results[i].percentiles.p90` (conservative bound for commitments) or `p95` (extreme conservative)
- Data path: GPT should present P90 as the commitment threshold; P95 for high-stakes commitments
- Status: ✅ FULL

**Q5: How wide is the uncertainty range?**
- API fields: `results[i].percentiles.p10`, `.p90` (range = p90 − p10)
- Data path: GPT computes range from returned percentiles; no direct "range" field — GPT must subtract
- Status: ✅ FULL (GPT computes, not returned explicitly)

**Q6: What is the PERT mean for this task?**
- API fields: Not directly returned as a standalone field. PERT mean = (O + 4M + P) / 6, which GPT can compute from the inputs.
- Status: ⚠️ PARTIAL — GPT must compute from user inputs; not a named response field

**Q7: Can I get a distribution chart?**
- API fields: `_charts.distribution` (QuickChart.io PNG URL, task[0] only)
- Data path: Present when `full_saco` or `saco_explain` is run on a single task; multi-task calls only chart task[0]
- Status: ⚠️ PARTIAL — chart is task[0] only; no per-task chart for tasks 2–10

**Q8: What are the optimized percentiles after SACO runs?**
- API fields: `results[i].optimizedPercentiles.p10`, `.p50`, `.p90`
- Data path: Present when the optimizer produced a reshaped CDF. Compare against `percentiles` (baseline) to see distribution shift.
- Status: ✅ FULL

---

### B. Probability at Target (Hitting a Specific Cost/Date)

**Q1: What is the probability we finish within budget?**
- API fields: `results[i].targetProbability.value.original` (baseline), `.adjusted` (with user sliders), `.adjustedOptimized` / `.adaptiveOptimized` (SACO optimal)
- Data path: GPT collects target → includes `targetValue` in task → response `targetProbability.value.*`
- Status: ✅ FULL

**Q2: What is the feasibility score for our target?**
- API fields: `results[i].feasibilityScore` (0–100 integer; only present when `targetValue` was supplied)
- Data path: Composite of P(SACO-optimized) × tail-risk discount. GPT leads stakeholder summaries with this number.
- Status: ✅ FULL

**Q3: Can you show me baseline vs. optimized probability side by side?**
- API fields: `results[i].targetProbability.value.original` vs. `adjustedOptimized`; also `_charts.probabilities` (bar chart PNG, task[0])
- Data path: Three-way table built from `targetProbability.value.*`; bar chart from `_charts.probabilities`
- Status: ✅ FULL

**Q4: How much does SACO improve my probability vs. baseline?**
- API fields: `decisionReports[].liftPoints` (= finalProbability − baselineProbability)
- Data path: Available in each `decisionReports` item for the Optimize mode report
- Status: ✅ FULL

**Q5: What does a feasibility score of 62 mean?**
- API fields: `results[i].feasibilityScore` is the number; interpretation is GPT-side
- Data path: GPT interprets using the canonical 4-band scale (matches knowledge-step4-display.md):
  - 80–100: High confidence — strong probability of hitting target
  - 60–79: Moderate confidence — achievable with disciplined execution
  - 40–59: Challenging — stretch target, review SACO recommendations
  - <40: High risk — revisit target, expand schedule, or adjust scope
- Status: ⚠️ PARTIAL — no machine interpretation field; GPT must explain based on score value

**Q6: What probability does the baseline give me at my target, before any optimization?**
- API fields: `results[i].targetProbability.value.original`
- Data path: Always returned when `targetValue` is supplied, regardless of sliders
- Status: ✅ FULL

---

### C. Confidence Intervals ("What Value Gives Me 90% Confidence?")

**Q1: What budget gives me 90% confidence of not overspending?**
- API fields: `results[i].targetAtConfidence.value` (when `confidenceTarget: 90` is set)
- Data path: GPT collects the desired confidence level → sets `confidenceTarget: 90` on the task → response `targetAtConfidence.value`
- Status: ✅ FULL

**Q2: At what value am I 80% confident of completing on time?**
- API fields: `results[i].targetAtConfidence.value` (when `confidenceTarget: 80` is set); alternatively read from `results[i].percentiles.p80`
- Data path: Two valid paths — `confidenceTarget: 80` gives exact CDF inversion; `percentiles.p80` gives the same value from the full percentile table
- Status: ✅ FULL

**Q3: What is the P85 value?**
- API fields: `results[i].targetAtConfidence` with `confidenceTarget: 85`; note that the standard `percentiles` object does not include P85 directly (P80 and P90 are the nearest available)
- Data path: Set `confidenceTarget: 85` on the task to get the exact P85 value
- Status: ✅ FULL (via confidenceTarget; not in the fixed percentile table)

**Q4: What does P90 mean in plain language?**
- No API field needed — GPT explains: "90% of simulated outcomes land at or below this value. Use P90 for commitment-level planning."
- Status: ✅ FULL (knowledge-level answer)

**Q5: Can I get percentiles for both baseline and optimized distributions?**
- API fields: `results[i].percentiles` (baseline P5–P95); `results[i].optimizedPercentiles` (SACO P10/P50/P90 only)
- Data path: Both returned in same response; `optimizedPercentiles` is limited to three points
- Status: ⚠️ PARTIAL — optimized distribution only returns P10/P50/P90, not full P5–P95 table

**Q6: What confidence level would I need to commit to a specific number?**
- Data path: GPT reads `percentiles` table and interpolates; or asks user for the specific value and sets it as `targetValue` to get `targetProbability`
- Status: ⚠️ PARTIAL — requires GPT to interpolate from percentile table or re-run with a targetValue

---

### D. SACO Optimization ("How Do I Improve My Probability?")

**Q1: What slider settings does SACO recommend?**
- API fields: `results[i].decisionReports[].winningSliders` (UI units; reworkPercentage 0–50, all others 0–100)
- Data path: Present in the Optimize mode `decisionReports` item. GPT presents as recommended management levers.
- Status: ✅ FULL

**Q2: How much should I change my current slider settings?**
- API fields: `results[i].sliderDelta` (per-slider difference: SACO recommended minus user input, UI units; only sliders with |delta| ≥ 1 included)
- Data path: Available when user provided `sliderValues` and optimizer ran. Positive = SACO raised this lever.
- Status: ✅ FULL

**Q3: What does the SACO narrative say about my results?**
- API fields: `results[i].decisionReports[].narrative`
- Data path: Human-readable summary of each SACO result block. Present in each `decisionReports` item.
- Status: ✅ FULL

**Q4: Can I run baseline-only without SACO optimization?**
- API fields: Set `operationType: "baseline_only"` (1 credit). Response has `percentiles` but no `decisionReports`, `optimizedPercentiles`, or `targetProbability.value.adjustedOptimized`.
- Status: ✅ FULL

**Q5: Can I get a deeper diagnostic explanation of what SACO did?**
- API fields: Set `operationType: "saco_explain"` (4 credits). Returns full analysis with diagnostics including `decisionReports[].diagnostics.monotonicityAtTarget`, `.chainingDrift`, `.allZeroSlidersPassThrough`, `.winnerHasSliders`.
- Status: ✅ FULL

**Q6: Is the optimization result reliable or is there a warning?**
- API fields: `results[i].decisionReports[].diagnostics.monotonicityAtTarget` ("Pass" or "Warn") — flags irregular distribution shape near target
- Data path: Available in `saco_explain` mode; present in `full_saco` if diagnostics are populated
- Status: ✅ FULL

**Q7: What is the probability gain from optimization?**
- API fields: `results[i].decisionReports[].liftPoints` (= finalProbability − baselineProbability, 0–1 scale)
- Status: ✅ FULL

---

### E. Management Context / 7 Levers (Slider Input → Three-Way Comparison)

**Q1: I have a hard deadline with no budget contingency — how does that affect my probability?**
- API fields: Set `scheduleFlexibility: 0`, `budgetFlexibility: 0` → `targetProbability.value.adjusted` shows probability with this context
- Data path: GPT encodes user's answers into `sliderValues`, calls API, presents three-way table
- Status: ✅ FULL

**Q2: My scope is completely locked. Does that help?**
- API fields: Set `scopeCertainty: 100`, `scopeReductionAllowance: 0` → adjusted probability reflects locked scope
- Status: ✅ FULL

**Q3: We expect about 20% rework. How does that affect our estimate?**
- API fields: `reworkPercentage: 20` (valid range 0–50) → shifts distribution mean and variance upward
- Status: ✅ FULL

**Q4: What does SACO recommend I do differently across all 7 levers?**
- API fields: `decisionReports[].winningSliders` (all 7 levers, UI units) compared against user input via `sliderDelta`
- Status: ✅ FULL

**Q5: Does raising budget flexibility always improve probability?**
- API fields: `results[i].sensitivity.sliders[].direction` for `budgetFlexibility` — shows "positive", "negative", or "neutral"
- Data path: Sensitivity is computed when `targetValue` is supplied. Direction tells GPT whether raising the lever helps or hurts.
- Status: ✅ FULL (requires targetValue)

**Q6: What is the three-way probability comparison table?**
- API fields: `targetProbability.value.original` (baseline), `.adjusted` (user context), `.adjustedOptimized` or `.adaptiveOptimized` (SACO optimal)
- Data path: All three values returned when target + sliders provided. GPT formats as a table. Always show this when a target is provided.
- Status: ✅ FULL

**Q7: Can I skip the slider questions?**
- API fields: Omit `sliderValues` entirely. Engine uses defaults (50 for all sliders). `adjusted` probability will reflect defaults rather than user context. `winningSliders` still returned.
- Status: ✅ FULL (with reduced diagnostic value)

---

### F. Counter-Intuition & Recommendations (Diagnostic Outputs)

**Q1: Are there any counter-intuitive findings about my project?**
- API fields: `results[i].decisionReports[].counterIntuition` — array of `{pattern, because, suggest}` objects
- Data path: Always surface `counterIntuition` items. Each represents a case where conventional PM intuition is counter-productive for this distribution shape.
- Status: ✅ FULL

**Q2: What actions do you recommend to improve my probability?**
- API fields: `results[i].decisionReports[].recommendations` — ranked array of actionable strings
- Status: ✅ FULL

**Q3: Why would tightening scope hurt my probability?**
- API fields: `counterIntuition[].because` explains the mechanism; `counterIntuition[].suggest` gives the alternative action
- Status: ✅ FULL

**Q4: Is there a human-readable summary of the SACO result?**
- API fields: `results[i].decisionReports[].narrative`
- Status: ✅ FULL

**Q5: Can I get the playbook-level diagnostics in a report?**
- API fields: `results[i]._reportUrl` — per-task shareable HTML report URL; full diagnostic text is in `decisionReports[]`
- Data path: GPT always offers `_reportUrl` at the end of every estimation
- Status: ✅ FULL

---

### G. Sensitivity Analysis (Which Levers Matter Most?)

**Q1: Which slider has the most impact on my probability of hitting target?**
- API fields: `results[i].sensitivity.sliders[0]` (first item = highest |gain|). Fields: `.slider` (name), `.gain` (dP/dSlider), `.direction`
- Data path: Sensitivity only present when `targetValue` was supplied. Sorted by |gain| descending. GPT presents top 3.
- Status: ✅ FULL (requires targetValue)

**Q2: Is this lever positively or negatively correlated with my probability?**
- API fields: `results[i].sensitivity.sliders[].direction` — "positive", "negative", or "neutral"
- Status: ✅ FULL (requires targetValue)

**Q3: What is the baseline probability used in the sensitivity calculation?**
- API fields: `results[i].sensitivity.baselineProbability` — P(X ≤ target) at current slider settings (0–1)
- Status: ✅ FULL

**Q4: Was sensitivity analysis skipped for some tasks?**
- API fields: `results[i].sensitivitySkipped: true` — set for tasks 6–10 in a multi-task request (GAS timeout prevention; sensitivity capped at first 5 tasks)
- Status: ✅ FULL

**Q5: What does a sensitivity gain of 0.003 mean?**
- GPT explains: increasing that slider by 1 UI unit raises P(hit target) by 0.003 (0.3 percentage points). No additional API field needed.
- Status: ✅ FULL (knowledge-level interpretation)

---

### H. Scenario / What-If Analysis (Up to 5 Per Task)

**Q1: What if we locked scope completely?**
- API fields: Include `scenarios: [{name: "Locked scope", sliderValues: {scopeCertainty: 100, scopeReductionAllowance: 0}}]` → `results[i].scenarios[0].probability`
- Data path: Each scenario returns `{name, targetValue, probability, note, error}`. No extra credits charged.
- Status: ✅ FULL

**Q2: What if we increased the budget target by 10%?**
- API fields: Include `scenarios: [{name: "10% higher budget", targetValue: <new_value>}]` → `results[i].scenarios[0].probability`
- Status: ✅ FULL

**Q3: Can I run 5 different what-if scenarios in one call?**
- API fields: `scenarios` array accepts up to 5 items per task. All results returned in `results[i].scenarios[]`.
- Status: ✅ FULL (hard cap: 5 scenarios per task, enforced by webapp.gs)

**Q4: What if I change both the target and the sliders in a scenario?**
- API fields: Scenario object can set both `targetValue` and `sliderValues` simultaneously
- Status: ✅ FULL

**Q5: How do I compare scenario results?**
- API fields: Each `results[i].scenarios[]` item has `.name`, `.probability`, and `.targetValue`. GPT builds a comparison table from these fields.
- Status: ✅ FULL

**Q6: Can scenarios run across multiple tasks?**
- API fields: Scenarios are per-task (`tasks[i].scenarios`). Each task can independently have up to 5 scenarios. Cross-task scenario aggregation is not a returned field — GPT must sum or compare manually.
- Status: ⚠️ PARTIAL — no portfolio-level scenario aggregation returned by API

---

### I. Portfolio Analysis (Multi-Task P10/P50/P90)

**Q1: What is the total project P10/P50/P90 across all tasks?**
- API fields: `_portfolio.p10`, `_portfolio.p50`, `_portfolio.p90`
- Data path: Present when 2 or more tasks are submitted. Aggregated using PERT sum (CLT normal approximation) for sequential tasks, or critical-path method if any tasks have `parallel: true`.
- Status: ✅ FULL

**Q2: How is the portfolio aggregation calculated?**
- API fields: `_portfolio.method` — "pert_sum" (all sequential) or "pert_critical_path" (mixed with parallel tasks)
- Status: ✅ FULL

**Q3: How many tasks are included in the portfolio total?**
- API fields: `_portfolio.taskCount`
- Status: ✅ FULL

**Q4: What if some tasks run in parallel?**
- API fields: Set `parallel: true` on parallel tasks → `_portfolio.method` switches to "pert_critical_path"; critical-path contribution (max mean + max variance) used for parallel group
- Status: ✅ FULL

**Q5: Can I get per-task P10/P50/P90 AND a portfolio total?**
- API fields: Per-task: `results[i].percentiles`; portfolio: `_portfolio`
- Status: ✅ FULL

---

### J. Critical Path Method (Dependencies → Critical Path, Float, Health Score)

**Q1: What is the critical path?**
- API fields: `cpEngine.deterministic.criticalPath` — ordered array of task ids with zero float
- Data path: CPM only runs when at least one task has a non-empty `predecessors` array. GPT must collect dependency information.
- Status: ✅ FULL (requires predecessor data from user)

**Q2: How much float does Task B have?**
- API fields: `cpEngine.deterministic.tasks["TaskB"].totalFloat`; also `.freeFloat`, `.interferingFloat`, `.independentFloat`
- Status: ✅ FULL

**Q3: What is the total project duration?**
- API fields: `cpEngine.deterministic.projectDuration` — duration at `cpmPercentile` (default P80)
- Note: Default uses P80 SACO duration per task, making this a conservative schedule. Use `cpmOptions.cpmPercentile: 0.50` for median (P50) schedule.
- Status: ✅ FULL

**Q4: What is the schedule health score?**
- API fields: `cpEngine.healthScore.score` (0–100 integer), `.grade` (A–F), `.interpretation` (one-sentence summary)
- Status: ✅ FULL

**Q5: What are the near-critical tasks?**
- API fields: `cpEngine.deterministic.nearCriticalTasks` — task ids with float < `nearCriticalThreshold` × projectDuration (default 10%)
- Status: ✅ FULL

**Q6: Does my schedule have negative float?**
- API fields: `cpEngine.healthScore.factors.hasNegativeFloat` (boolean); `cpEngine.deterministic.tasks[id].totalFloat < 0` per task
- Status: ✅ FULL

**Q7: What dependency types are supported?**
- API fields: `predecessors[].type` accepts FS (Finish-to-Start, default), SS (Start-to-Start), FF (Finish-to-Finish), SF (Start-to-Finish); `lag` (positive) or lead (negative lag) in same units as estimates
- Status: ✅ FULL

**Q8: How close is a near-critical task to joining the critical path?**
- API fields: `cpEngine.deterministic.tasks[id].tippingPoint` — duration at which the task would become critical; `.tippingSeverity` (low/medium/high/critical)
- Status: ✅ FULL

---

### K. Stochastic Schedule (S-Curve, Criticality Index, Tornado Chart)

**Q1: What is the probability of finishing by date X?**
- API fields: `cpEngine.stochastic.sCurve` — 25 evenly-spaced `{x: duration, y: cumulative_probability}` pairs. GPT reads off the y value at the nearest x to the user's target duration.
- Data path: Stochastic CPM runs by default when predecessors are present. GPT interpolates from 25-point S-curve.
- Status: ✅ FULL

**Q2: What is the P80 stochastic project duration?**
- API fields: `cpEngine.stochastic.projectDuration.p80`
- Status: ✅ FULL

**Q3: What is the stochastic P50 and P90 project duration?**
- API fields: `cpEngine.stochastic.projectDuration.p50`, `.p90`
- Status: ✅ FULL

**Q4: Which tasks are most likely to end up on the critical path?**
- API fields: `cpEngine.stochastic.criticalityIndex` — per-task object (keyed by task id) with fraction of MC iterations where that task was on the critical path (0–1). Higher = bigger schedule risk driver.
- Status: ✅ FULL

**Q5: What is the top schedule risk driver?**
- API fields: `cpEngine.stochastic.tornado[0]` — highest Schedule Sensitivity Index (SSI). Fields: `.id`, `.name`, `.ssi`, `.criticalityIndex`
- Status: ✅ FULL

**Q6: Is my deterministic CPM underestimating duration due to merge point bias?**
- API fields: `cpEngine.deterministic.mergePointBiasWarning` — string warning present when convergence nodes exist; null otherwise
- Status: ✅ FULL

**Q7: How many Monte Carlo iterations were run?**
- API fields: `cpEngine.stochastic.iterations`
- Status: ✅ FULL

**Q8: Can I skip stochastic CPM to speed up the response?**
- API fields: Set `cpmOptions.stochastic: false` on any task. Stochastic block will be null.
- Status: ✅ FULL

---

### L. Visualization (Live Plot, Report Link)

**Q1: Can I see my results as a chart?**
- API fields: `_charts.distribution` (distribution PNG), `_charts.probabilities` (bar chart PNG) — both QuickChart.io URLs; task[0] only
- Data path: GPT embeds these inline in the response on first estimation
- Status: ⚠️ PARTIAL — only task[0] charts available for multi-task calls

**Q2: Can I get an interactive live visualization?**
- API fields: `_plotUrl` — GitHub Pages interactive visualization URL. Present after first `call_api`. Contains KPI tiles from URL params; re-renders when same `session_token` is used on subsequent calls.
- Data path: Show `_plotUrl` as a labeled block after first estimation. On re-runs say "Visualization updated." — do not generate a new link.
- Status: ✅ FULL

**Q3: How do I get a shareable report link?**
- API fields: `results[i]._reportUrl` (per-task) — standalone HTML report. Top-level `_reportUrl` is backward-compatible alias for task[0] only.
- Status: ✅ FULL

**Q4: Does the live plot update when I re-run with new sliders?**
- API fields: Include `session_token: <stored _sessionToken>` on re-run → same `_plotUrl` updates in place. No new URL is generated.
- Data path: GPT stores `_sessionToken` from first response; passes it on every subsequent `call_api` call
- Status: ✅ FULL

---

### M. Session Management (Save/Load)

**Q1: Can I save my estimation session to come back to later?**
- API fields: `action: "save_session"` with `key`, `email`, `session: {project, tasks, results_summary}` (under 50 KB) → returns `session_id`, `saved_at`
- Status: ✅ FULL

**Q2: Can I load my previous sessions?**
- API fields: `action: "load_sessions"` with `key`, `email` → returns `sessions[]` (last 5) with `.session_id`, `.saved_at`, `.project`, `.task_count` — and `count`
- Status: ✅ FULL

**Q3: How many sessions can I load at once?**
- API fields: `load_sessions` returns last 5 saved sessions. No pagination.
- Status: ✅ FULL

---

### N. Account & Credits (Trial, Quota, Upgrade)

**Q1: I don't have an API key — can I try it?**
- API fields: `action: "request_trial"` with `email` (and optional `promo`) → user receives key by email
- Status: ✅ FULL

**Q2: How many credits do I have left?**
- API fields: `action: "check_quota"` with `key` → returns `remaining`, `total`, `used`, `status`, `bar` (visual usage bar)
- Also returned on every `call_api` response: `_quota.credits_remaining`, `_quota.credits_total`, `_quota.credits_this_call`, `_quota.bar`
- Status: ✅ FULL

**Q3: How much does each operation cost?**
- `baseline_only`: 1 credit. `full_saco`: 2 credits (default). `saco_explain`: 4 credits. CPM and scenarios are free alongside SACO.
- Status: ✅ FULL (knowledge-level, not an API field)

**Q4: My key is expired or exhausted — what do I do?**
- API fields: Response contains `upgrade_url` when key is invalid/expired/exhausted → GPT shows link to icarenow.io
- Status: ✅ FULL

---

## 3. Input Validation Rules

GPT must enforce these rules before every `call_api` call:

**Estimates:**
- `optimistic ≤ mostLikely ≤ pessimistic` (strict; equal values at edges are allowed)
- All three must be finite numbers (`Number.isFinite`)
- Absolute value of each must be ≤ 1,000,000,000
- All three fields are required (missing any one → API error)
- `task` name is required

**Slider Values (all optional; default 50 when omitted):**
| Slider | UI Range | Note |
|--------|----------|------|
| `budgetFlexibility` | 0–100 | Standard |
| `scheduleFlexibility` | 0–100 | Standard |
| `scopeCertainty` | 0–100 | Standard |
| `scopeReductionAllowance` | 0–100 | Standard |
| `reworkPercentage` | **0–50** | Special domain — half the others |
| `riskTolerance` | 0–100 | Standard |
| `userConfidence` | 0–100 | Standard |

**confidenceTarget:**
- Must be an integer (no decimals)
- Range: 1–99 inclusive
- Requesting P100 or P0 is invalid

**Tasks per request:**
- Minimum: 1
- Maximum: 10 (hard limit enforced by webapp.gs line 99–100)

**Scenarios:**
- Maximum 5 per task
- Each scenario must have a `name`
- Each scenario must have at least one of: `targetValue` or `sliderValues`
- `targetValue` in a scenario must be a finite number if provided

**parallel flag:**
- Must be a boolean (`true` or `false`); any other type is rejected

**predecessors:**
- Each entry is either a string task id/name OR an object with required `id` field
- `type` must be one of: FS, SS, FF, SF (defaults to FS)
- `lag` must be a finite number (positive = lag, negative = lead)
- Circular dependencies are detected and rejected with a `CYCLES_DETECTED` error

**session_token:**
- Must match pattern `^[a-f0-9]{32,64}$` if provided; otherwise GAS generates one
- Omit on first call; include on all subsequent calls in same conversation

**operationType:**
- Must be one of: `baseline_only`, `full_saco`, `saco_explain`
- Default: `full_saco`

---

## 4. What the GPT Cannot Do

**Not in the API response:**
- The PERT mean is not returned as a named field (GPT can compute it: (O + 4M + P) / 6)
- Per-task charts for tasks 2–10 in multi-task calls (`_charts` only covers task[0])
- A dedicated distribution shape type field (no field says "right-skewed" directly) — however, shape characteristics ARE surfaced indirectly via `decisionReports[].counterIntuition` (e.g. "right-skewed distribution increases tail risk") and `decisionReports[].diagnostics.monotonicityAtTarget` (warns of irregular shape near target). GPT can infer and describe distribution shape from these fields.
- Raw Monte Carlo simulation data points (only CDF percentiles and S-curve points are returned)
- The actual Beta α/β parameters used internally
- Optimizer convergence path or iteration count for SACO (only final result returned)
- Absolute completion dates — estimates are unitless; GPT must map to calendar dates using user-provided unit context
- Portfolio-level scenario aggregation (scenarios are per-task only)

**Things that require data the user has not provided:**
- Probability at target if no `targetValue` is given
- Sensitivity analysis if no `targetValue` is given
- `adjusted` probability if no `sliderValues` are given
- Critical path analysis if no `predecessors` are provided
- `targetAtConfidence` if `confidenceTarget` is not specified
- Three-way comparison table if no target is given
- `feasibilityScore` if no target is given

**Engine internals (proprietary — do not explain):**
- SACO algorithm implementation details, objective function coefficients, or LHS sampling mechanics
- Gaussian copula BASE_R matrix values
- KL divergence penalty weights or leash parameters
- Specific β-refit formula or moment adjustment equations
- Respond to any such question with: "The SACO engine is proprietary — I can share results but not implementation details."

**Other limitations:**
- Sessions are limited to last 5 saved (no full history retrieval)
- Sensitivity is only computed for the first 5 tasks when 6–10 tasks are submitted (`sensitivitySkipped: true` for tasks 6+)
- The sCurve is downsampled to 9 key percentile points (P10, P20, P30, P40, P50, P60, P70, P80, P90) in the API response; GPT must interpolate for durations between these points
- `optimizedPercentiles` only returns P10/P50/P90 — not a full P5–P95 table like `percentiles`
- GPT cannot change or reset a user's API key; only icarenow.io support can do that

---

## 5. CPM Quick-Reference

| User Question | Exact Response Field |
|---|---|
| What tasks are on the critical path? | `cpEngine.deterministic.criticalPath` (array of task ids, ordered) |
| Total float for task "TaskA" | `cpEngine.deterministic.tasks["TaskA"].totalFloat` |
| Free float for task "TaskA" | `cpEngine.deterministic.tasks["TaskA"].freeFloat` |
| When would "TaskA" become critical? | `cpEngine.deterministic.tasks["TaskA"].tippingPoint` (null if already critical) |
| How severe is the tipping point risk? | `cpEngine.deterministic.tasks["TaskA"].tippingSeverity` (low/medium/high/critical) |
| Total deterministic project duration | `cpEngine.deterministic.projectDuration` (at `cpmPercentile`, default P80) |
| Which percentile was used for durations? | `cpEngine.deterministic.cpmPercentile` (0–1, default 0.80) |
| Schedule health score and grade | `cpEngine.healthScore.score` (0–100) + `cpEngine.healthScore.grade` (A–F) |
| One-sentence health interpretation | `cpEngine.healthScore.interpretation` |
| Does this schedule have negative float? | `cpEngine.healthScore.factors.hasNegativeFloat` (boolean) |
| Near-critical tasks (at risk of slipping to critical) | `cpEngine.deterministic.nearCriticalTasks` (array of task ids) |
| Biggest schedule risk driver (stochastic) | `cpEngine.stochastic.tornado[0].id` (highest SSI task) + `.ssi` |
| Top 3 schedule risk drivers | `cpEngine.stochastic.tornado[0..2]` |
| Criticality index for task "TaskA" | `cpEngine.stochastic.criticalityIndex["TaskA"]` (0–1, fraction of MC runs on critical path) |
| Stochastic P50 project duration | `cpEngine.stochastic.projectDuration.p50` |
| Stochastic P80 project duration | `cpEngine.stochastic.projectDuration.p80` |
| Stochastic P90 project duration | `cpEngine.stochastic.projectDuration.p90` |
| Probability of finishing by duration X | Read `cpEngine.stochastic.sCurve` — 9 `{x, y}` pairs at P10–P90; interpolate at x = target duration |
| Stochastic mean and sigma | `cpEngine.stochastic.projectDuration.mean` + `.sigma` |
| Merge point bias warning | `cpEngine.deterministic.mergePointBiasWarning` (string or null) |
| Number of convergence nodes (merge points) | `cpEngine.deterministic.graphMetrics.convergenceCount` |
| How many MC iterations were run? | `cpEngine.stochastic.iterations` |
| Are there network validation errors? | `cpEngine.deterministic.validationErrors` (array of strings) |
| CPM status (ok or error) | `cpEngine.status` |
| What went wrong with CPM? | `cpEngine.message` (only when `status = "error"`) |

---

## 6. Example API Call Shapes

These show the `tasks` array and relevant top-level options only. `action`, `key`, and `operationType` are always required in the real request.

### 6.1 Single Task, No Target, No Sliders
```json
{
  "action": "call_api",
  "key": "<user_key>",
  "operationType": "full_saco",
  "tasks": [
    {
      "task": "Website Redesign",
      "optimistic": 40000,
      "mostLikely": 60000,
      "pessimistic": 90000
    }
  ]
}
```

### 6.2 Single Task with Target and Sliders
```json
{
  "action": "call_api",
  "key": "<user_key>",
  "operationType": "full_saco",
  "tasks": [
    {
      "task": "Website Redesign",
      "optimistic": 40000,
      "mostLikely": 60000,
      "pessimistic": 90000,
      "targetValue": 70000,
      "sliderValues": {
        "budgetFlexibility": 30,
        "scheduleFlexibility": 50,
        "scopeCertainty": 70,
        "scopeReductionAllowance": 20,
        "reworkPercentage": 15,
        "riskTolerance": 60,
        "userConfidence": 65
      }
    }
  ]
}
```

### 6.3 Multi-Task Portfolio (3 Tasks, Sequential)
```json
{
  "action": "call_api",
  "key": "<user_key>",
  "operationType": "full_saco",
  "tasks": [
    {
      "task": "Phase 1 — Discovery",
      "optimistic": 15000,
      "mostLikely": 22000,
      "pessimistic": 35000
    },
    {
      "task": "Phase 2 — Development",
      "optimistic": 50000,
      "mostLikely": 70000,
      "pessimistic": 110000
    },
    {
      "task": "Phase 3 — Launch",
      "optimistic": 10000,
      "mostLikely": 15000,
      "pessimistic": 25000
    }
  ]
}
```
Note: `_portfolio` is returned automatically with P10/P50/P90 for the total project. Method will be `pert_sum` (all sequential).

### 6.4 Multi-Task with CPM (Task B depends on A; Task C depends on B)
```json
{
  "action": "call_api",
  "key": "<user_key>",
  "operationType": "full_saco",
  "tasks": [
    {
      "id": "A",
      "task": "Phase 1 — Discovery",
      "optimistic": 15,
      "mostLikely": 22,
      "pessimistic": 35
    },
    {
      "id": "B",
      "task": "Phase 2 — Development",
      "optimistic": 50,
      "mostLikely": 70,
      "pessimistic": 110,
      "predecessors": ["A"]
    },
    {
      "id": "C",
      "task": "Phase 3 — Launch",
      "optimistic": 10,
      "mostLikely": 15,
      "pessimistic": 25,
      "predecessors": ["B"],
      "cpmOptions": {
        "cpmPercentile": 0.80,
        "stochastic": true,
        "stochasticN": 500
      }
    }
  ]
}
```
Note: `cpEngine` block will be present in response. `cpmOptions` placed on any one task applies to the whole network.

### 6.5 Task with Scenario Analysis (2 What-Ifs)
```json
{
  "action": "call_api",
  "key": "<user_key>",
  "operationType": "full_saco",
  "tasks": [
    {
      "task": "Marketing Campaign",
      "optimistic": 80000,
      "mostLikely": 120000,
      "pessimistic": 180000,
      "targetValue": 130000,
      "sliderValues": {
        "budgetFlexibility": 40,
        "scopeCertainty": 60,
        "reworkPercentage": 10
      },
      "scenarios": [
        {
          "name": "Locked scope",
          "sliderValues": {
            "scopeCertainty": 100,
            "scopeReductionAllowance": 0
          }
        },
        {
          "name": "10% higher target",
          "targetValue": 143000
        }
      ]
    }
  ]
}
```

### 6.6 Task Requesting confidenceTarget at P85
```json
{
  "action": "call_api",
  "key": "<user_key>",
  "operationType": "full_saco",
  "tasks": [
    {
      "task": "Infrastructure Migration",
      "optimistic": 200000,
      "mostLikely": 310000,
      "pessimistic": 500000,
      "confidenceTarget": 85
    }
  ]
}
```
Note: Response will include `results[0].targetAtConfidence.value` — the dollar amount at which P(cost ≤ value) = 85%. If `targetValue` is also provided, both `targetProbability` and `targetAtConfidence` will be present simultaneously.
