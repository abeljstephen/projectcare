# Step 4 Display Rules — ProjectCare by iCareNOW
# Full formatting reference for presenting estimation results

---

## 4a. Feasibility Score

Source: `results[i].feasibilityScore` (integer 0–100)

Always lead with the feasibility score. It is the single most important headline number — it combines SACO-optimized probability with tail risk penalty.

Scoring bands and recommended framing:
- **80–100 (High confidence):** "Your estimates are well-supported. Strong probability of hitting your target with the conditions you described."
- **60–79 (Moderate confidence):** "Achievable, but execution will need to be disciplined. There are specific levers that could push this higher."
- **40–59 (Challenging):** "This target is a stretch given current estimates and context. I'd recommend reviewing the SACO recommendations and counter-intuition warnings below."
- **<40 (High risk):** "Your target is very ambitious relative to the distribution. You may want to revisit the target, expand the schedule, or adjust scope before committing."

If feasibilityScore is missing from the response (can happen on baseline_only calls), skip this section silently.

---

## 4b. Confidence Interval

Source: `results[i].percentiles` (P5 through P95), PERT mean = `(O + 4M + P) / 6`

Always show:
- **P10** — only 10% of outcomes fall below this (optimistic bound)
- **P50** — median outcome (most likely if the distribution is symmetric)
- **P90** — 90% of outcomes fall below this (conservative commitment point)
- **PERT mean** — classic weighted average for comparison

Format example:
```
P10: 18 days   (optimistic)
P50: 26 days   (median)
P90: 38 days   (conservative — suitable for stakeholder commitments)
PERT mean: 26.3 days
```

If `targetAtConfidence` is present in the result (user requested a specific percentile via `confidenceTarget`):
→ "At [X]% confidence, you need to plan for [value] [unit]."

Explain the spread: if P90 − P10 is large relative to P50 (>50% of P50), note that the distribution has high variance and estimates carry significant uncertainty.

---

## 4c. Three-Way Probability Table

Source: `results[i].targetProbability.value` — fields: `original`, `adjusted`, `adjustedOptimized`, `adaptiveOptimized`

Only show when a `targetValue` was provided. This is the core differentiator of ProjectCare by iCareNOW.

Always format as a comparison table:
```
Baseline (no context):     [original × 100]%
Your management context:   [adjusted × 100]%    (+X pp vs baseline)
SACO optimized:            [best_optimized × 100]%    (+Y pp vs baseline)
```

Where `best_optimized` = `max(adjustedOptimized, adaptiveOptimized)`. If they differ by ≥ 1 pp, add a note: "*(Adaptive pass improved by [delta] pp over fixed optimization.)*"

Rules:
- Round all values to one decimal place
- Show delta vs baseline in parentheses with sign (e.g. "+12 pp" or "−3 pp")
- If `adjusted` = `original` (no sliders were sent), omit the middle row entirely and add: "*(Management context not provided — your context row would appear here. I can collect it now at no extra credit cost.)*"
- If `best_optimized` < `adjusted`: explain that SACO found the user's slider settings were already near-optimal, or that the distribution shape limits further improvement
- The "pp" abbreviation stands for percentage points — spell it out if the audience seems non-technical

Interpretation guidance to always include:
- Baseline = what the raw math says with no project context
- Your context = how your management levers shift the probability
- SACO optimized = the best achievable probability given the distribution shape, found by the optimizer

---

## 4d. SACO Slider Recommendations

Source: `decisionReports[*].winningSliders`

Show the recommended lever settings as actionable bullets, not raw numbers. Translate each slider to plain business language:

| Internal slider name | Plain English meaning |
|---|---|
| scheduleFlexibility | How much timeline buffer or float exists |
| budgetFlexibility | Size of contingency reserves |
| scopeCertainty | How locked down the requirements are |
| scopeReductionAllowance | Ability to defer or cut scope items if needed |
| reworkPercentage | Expected revision and iteration cycles |
| riskTolerance | Team/stakeholder comfort with uncertainty |
| userConfidence | Confidence in the accuracy of O/M/P estimates |

Format example:
- "Add more schedule buffer (flexibility: 72) — the distribution is right-skewed; a hard deadline is your biggest risk driver."
- "Reduce expected rework to 15% — your current rework assumption is inflating the P90 significantly."

Never show raw slider numbers alone without the plain-English explanation.

---

## 4e. Slider Delta

Source: `results[i].sliderDelta`

Present only if the object is non-empty. Shows the difference between the user's input sliders and SACO's winning sliders.

Format: one line per changed lever.
```
scheduleFlexibility:  +28  (you: 25 → SACO: 53)
budgetFlexibility:    +15  (you: 40 → SACO: 55)
reworkPercentage:     −10  (you: 30 → SACO: 20)
```

Always add interpretation: "Positive values mean SACO recommends increasing that lever. Negative means reducing it. These represent the changes that most improve your probability of hitting the target."

If no delta is present (user sent no sliders, so nothing to compare), skip silently.

---

## 4f. Distribution Shift (Before / After SACO)

Source: `results[i].optimizedPercentiles` (P10, P50, P90 on the SACO-reshaped distribution)
Compare against `results[i].percentiles` (baseline P10, P50, P90)

Show as a before/after table:
```
             Baseline    SACO Optimized    Change
P10:         18 days     15 days           −3 days
P50:         26 days     22 days           −4 days
P90:         38 days     31 days           −7 days
```

Note: the distribution shift shows how SACO physically moved the distribution, not just the probability at target. A left-shift means better outcomes across all percentiles.

If `optimizedPercentiles` is absent, skip this section.

---

## 4g. Counter-Intuition Warnings

Source: `decisionReports[*].counterIntuition`

Always show if present. Format each as a ⚠️ warning on its own line.

These are cases where conventional project management instinct would make outcomes worse on this specific distribution shape. Examples of what these might say:
- "⚠️ Adding schedule buffer beyond 60 increases tail variance on this right-skewed distribution — the P90 gets worse, not better."
- "⚠️ Increasing scope certainty above 80 shows diminishing returns here; the dominant risk driver is rework, not requirements churn."

Always explain that these findings are specific to this task's distribution — they are not general advice and may differ for other tasks.

---

## 4h. Recommendations

Source: `decisionReports[*].recommendations`

Present as a numbered action plan the PM can take to the team. These are the most actionable output of the tool.

Example format:
1. Negotiate 2–3 weeks of schedule float with sponsors before committing to the delivery date.
2. Reduce the rework assumption from 30% to 15% by conducting a requirements review before development begins.
3. Set aside a 15% budget contingency — your current reserves are below what the distribution warrants.

If multiple decisionReports are present (one for adjusted, one for optimized), show the optimized report's recommendations as the primary action plan.

---

## 4i. Diagnostics

Show warnings when the following flags are present:

**`monotonicityAtTarget: "Warn"`** → "⚠️ The distribution has an irregular shape near your target value. Interpolated probabilities in this region may be less precise — treat the probability estimate as approximate."

**`chainingDrift > 0.05`** (value is a decimal, e.g. 0.08 = 8%) → "⚠️ The optimizer detected [X]% drift between the fixed and adaptive passes. Results are valid but conservative — the true optimum may be slightly higher."

These are rare and most users will never see them. If absent, skip silently.

---

## 4j. Charts

Source: `_charts.distribution`, `_charts.probabilities`

Display both charts inline using markdown image syntax when present. They are QuickChart.io URLs.

- Distribution chart: shows baseline PDF vs SACO-optimized PDF. Point out where the target falls on the distribution.
- Probability bar chart: shows the three-way comparison visually (baseline / your context / SACO optimized).

If either URL is null or absent, skip that chart silently — do not show broken links.

---

## 4k. Report Links

Source: `results[i]._reportUrl`

Always offer the report link at the end of results. Frame as:
"Here's your shareable one-page report — suitable for sending to stakeholders or sponsors: [link]"

For multi-task estimations, list each task's report link separately, labeled by task name.

The top-level `_reportUrl` covers task[0] for backward compatibility. Always prefer `results[i]._reportUrl` per task.

---

## 4l. Credits

Source: `_quota.bar`, `_quota.credits_remaining`, `_quota.credits_total`

Always show the credit bar after results. Example:
"Credits: ████████████░░░░░░░░  60% remaining (33 / 55)"

Proactive warnings:
- Remaining ≤ 20% of total: "⚠️ You're running low on credits. Upgrade at icarenow.io to continue."
- Remaining = 0: show upgrade URL immediately.

---

## 4m. Portfolio Summary (2+ tasks)

Source: `_portfolio` — fields: `taskCount`, `p10`, `p50`, `p90`, `method`

Show after individual task results:
```
Portfolio Summary (4 tasks)
P10: $280k   P50: $340k   P90: $420k
Method: PERT sum (sequential tasks)
```

Method explanations (show in plain English):
- `pert_sum` — tasks run sequentially; variance accumulates across the chain
- `pert_critical_path` — some tasks run in parallel; portfolio is driven by the longest parallel branch

Flag if `_portfolio.p90` exceeds the sum of individual task P50s by more than 15%:
"⚠️ Your portfolio P90 is significantly higher than the sum of median estimates — compounding tail risk across tasks is a real concern. Consider adding contingency at the portfolio level."

---

## 4n. Sensitivity Analysis

Source: `results[i].sensitivity` — fields: `baselineProbability`, `sliders[]` (each: `slider`, `gain`, `direction`)

Show top 3 levers by absolute value of `gain`. Format:
```
Most impactful levers for hitting your target:
1. scheduleFlexibility  — each +1 point raises P(target) by ~0.4 pp  ↑
2. reworkPercentage     — each +1 point lowers P(target) by ~0.3 pp  ↓
3. userConfidence       — each +1 point raises P(target) by ~0.1 pp  ↑
```

Always name the top lever explicitly in the Next Actions menu (see Next Actions Menu section below).

If `sensitivitySkipped: true`: "Sensitivity analysis was skipped for this task (exceeded the 5-task limit). Re-run this task individually to get lever rankings."

If `sensitivity` is absent entirely (no target provided, or call failed), skip silently.

---

## 4o. Scenarios

Source: `results[i].scenarios` — array of `{ name, targetValue, probability }`

Show as a comparison table:
```
Scenario                      Target    P(≤ target)   vs. Baseline
Optimistic target ($300k)     $300k     42%           −18 pp
Base target ($340k)           $340k     60%           baseline
Conservative target ($400k)   $400k     81%           +21 pp
```

Scenarios are computed at no extra credit cost. Offer to add scenarios if none were provided and the user seems to be exploring "what-ifs".

---

## Next Actions Menu (always close results with this)

Always end every result presentation with a numbered menu. Adapt to context:

**Default menu:**
1. Adjust your management levers — [name top sensitivity lever] is your strongest lever
2. Run a what-if scenario — try a different target, tighter deadline, or budget cut
3. Add more tasks — model the full project and get portfolio P10/P50/P90
4. Explain the SACO recommendations in plain English
5. Save this session
6. Get a shareable report for your stakeholder

**Adaptations:**
- feasibilityScore < 50 → lead option 1 with "Improve your probability"
- No sliders sent → replace #1 with "Add your project context — 7 levers, no extra credit"
- 2+ tasks → add "Identify the riskiest task driving your P90"
- counterIntuition warnings shown → add "Understand the counter-intuition warnings"
- Max 6 options shown at once
