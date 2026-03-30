# ProjectCare Validation Roadmap
## Empirical Testing Plan for Distribution Reshaping System

**Version:** 1.0
**Created:** February 2026
**TimeFrame:** 12 months (4 phases)
**Effort Estimate:** 12-15 person-weeks total
**Key Deliverables:** Brier score improvement, sensitivity ranking, peer-reviewed publication

---

## EXECUTIVE SUMMARY

This document operationalizes the 10-test framework from the Research Synthesis document into a concrete, executable plan with timelines, success criteria, and resource requirements.

**High-Level Goal:** Validate that ProjectCare's slider-based distribution adjustment empirically improves project outcome predictions over baseline PERT estimation.

**Key Metric:** Brier score reduction of 10-20% (from ~0.25 to ≤0.22) with slider adjustments vs. baseline alone.

---

## PHASE 1: FOUNDATION & RETROSPECTIVE VALIDATION (Now - Month 2)

### Test 1.1: Historical Data Collection
**Objective:** Gather ≥30 projects with (O, M, P, actual duration, slider adjustments)

**Method:**
1. Query project management database / spreadsheet archive
2. Identify projects from past 2-3 years with three-point estimates
3. For each project, extract:
   - Optimistic (O), Most-Likely (M), Pessimistic (P) estimates
   - Actual duration (from time tracking or close-out reports)
   - If available: expert slider values (budgetFlexibility, scheduleFlexibility, etc.)
   - Project metadata: team size, technology domain, project type (FDD, infrastructure, etc.)

**Acceptance Criteria:**
- ✓ ≥30 projects with complete O/M/P and actual duration
- ✓ ≥10 projects with slider adjustments available
- ✓ Data quality: estimates made at project start (not revised)
- ✓ Actuals verified against time tracking records

**Effort:** 1-2 weeks (depends on data availability)
**Owner:** Data analyst or PMO
**Output:** Cleaned CSV with columns: [project_id, O, M, P, actual, sliders_json, domain, team_size]

**Risks:**
- Actual data missing (solutions: approximate from close-out reports, use schedule variance)
- Slider data incomplete (accept subset for validation)
- Estimates revised during project (exclude or flag)

---

### Test 1.2: Brier Score Baseline Computation
**Objective:** Establish baseline Brier score (PERT only, no sliders)

**Method:**
1. For each project:
   ```
   baseline_prob = P(actual ≤ target_value | PERT distribution)
   outcome = 1 if actual ≤ target, 0 otherwise
   brier_i = (baseline_prob_i - outcome_i)^2
   ```
2. Aggregate: Brier_baseline = mean([brier_1, ..., brier_n])

**Considerations:**
- **Target value definition:** Typically use M (most-likely) as target. Sensitivity check with P (pessimistic).
- **Success definition:** Actual ≤ M is "on time"; actual > M is "overrun"
- **Edge cases:**
  - If actual < O (overachieved): outcome = 1 (success)
  - Ensure CDF computed correctly (monotone, 0 to 1)

**Acceptance Criteria:**
- ✓ Brier_baseline computed for each project
- ✓ Brier mean ≈ 0.24-0.28 (matches literature baseline of ~0.25)
- ✓ Histogram of individual Brier scores generated (sanity check)

**Effort:** 1 week (coding + computation)
**Owner:** Data scientist
**Output:** Baseline Brier score report; distribution of scores by project domain

**Expected Result:**
```
Baseline Brier Score Summary (n=30 projects):
Mean: 0.264
Std Dev: 0.089
Min: 0.001 (perfect forecast)
Max: 0.678 (terrible forecast)
Median: 0.251
```

---

### Test 1.3: Slider-Adjusted Brier Score Computation
**Objective:** Compare baseline vs. slider-adjusted Brier scores

**Method:**
1. For projects with available slider data:
   ```
   adjusted_prob = computeSliderProbability({
     points: baseline_beta_distribution,
     sliders: expert_slider_values,
     target: M
   })

   brier_adjusted_i = (adjusted_prob_i - outcome_i)^2
   ```
2. Compute Brier_adjusted = mean(brier_adjusted_i)
3. Calculate improvement: ΔBrier = Brier_baseline - Brier_adjusted (positive = improvement)

**Pairing Analysis (if ≥10 projects with both baseline & adjusted):**
- Paired t-test: H₀: ΔBrier = 0 vs. H₁: ΔBrier > 0 (two-tailed)
- Compute t-statistic and p-value
- Effect size: Cohen's d = ΔBrier_mean / ΔBrier_stdev

**Acceptance Criteria:**
- ✓ ΔBrier_mean > 0.01 (at least 0.01 improvement)
- ✓ Improvement consistent across domains (no systematic disadvantage)
- ✓ p-value < 0.10 for paired test (borderline significance acceptable for n≥10)

**Effort:** 1 week
**Owner:** Data scientist
**Output:** Comparison report; before/after scatter plot

**Expected Result:**
```
Slider-Adjusted Brier Score:
Mean: 0.218 (±0.08)
Improvement over baseline: ΔBrier = 0.046 (17% relative reduction)
Paired t-test: t(9) = 1.85, p = 0.098 (borderline significant)
```

---

### Test 1.4: Calibration Audit (PIT Test)
**Objective:** Check if adjusted probabilities match actual outcomes (are they well-calibrated?)

**Method:**
1. For each project with slider adjustment, compute:
   ```
   pit_i = CDF_adjusted(actual_i | adjusted distribution)
   ```
   This is the "probability integral transform" — should be uniform on [0,1] if well-calibrated

2. Assess uniformity:
   - Plot histogram of pit values (should be flat across 10 bins)
   - Kolmogorov-Smirnov test: H₀: PIT ~ Uniform[0,1]
   - Compute KS statistic d = max|F_empirical(pit) - F_uniform(pit)|

3. Reliability diagram:
   - Bin forecasts into groups (p∈[0-.1], [.1-.2], ..., [.9-1.0])
   - For each bin, plot: (bin center) vs (observed frequency of success)
   - Should fall on diagonal line if calibrated

**Acceptance Criteria:**
- ✓ KS test p-value > 0.05 (fail to reject uniformity)
- ✓ Reliability diagram points ±10% from diagonal
- ✓ No systematic over/under-confidence (avoid clustering above/below line)

**Effort:** 1.5 weeks
**Owner:** Statistician
**Output:** PIT histogram, reliability diagram, KS test results

**Expected Result:**
```
PIT Uniformity Test (n=10 projects with sliders):
KS statistic: d = 0.237
p-value: 0.089 (fail to reject uniformity; p > 0.05)
Interpretation: Forecasts are reasonably well-calibrated

Reliability Diagram: Points scatter ±12% from diagonal
(slight overconfidence: forecasts slightly too extreme)
```

---

### Test 1.5: Counter-Intuition Rule Audit
**Objective:** Did the rules engine actually prevent poor decisions?

**Method:**
1. Identify projects where rules engine flagged counter-intuition warnings (e.g., "Rework% is high")
2. Compare outcomes:
   - Warned projects: Did they have worse overruns than non-warned?
   - Chi-squared test: warned vs. not-warned, success vs. failure
3. Interpretation: If rules engine helps, warned projects should have:
   - Higher awareness of risk
   - More conservative estimates
   - Better eventual outcomes (if team heeds warning)

**Acceptance Criteria:**
- ✓ Chi-squared p-value < 0.10 (some association between warning and outcome)
- ✓ Warned projects don't perform worse (guardrails not harmful)
- ✓ Qualitative feedback: Did team find warnings useful?

**Effort:** 1 week (retrospective analysis + survey)
**Owner:** PM / Research lead
**Output:** Contingency table, chi-squared test, qualitative feedback summary

**Expected Result:**
```
Rules Engine Impact:
Warned projects (n=8): 5 successful, 3 overrun
Not warned (n=22): 10 successful, 12 overrun

Chi-squared: χ²(1) = 1.42, p = 0.234
Interpretation: Trend toward warned projects doing better, but not significant (n too small)

Qualitative: "Warnings made us re-examine scope; helpful" (3 teams)
```

---

## Phase 1 Summary

**Total Effort:** 4-5 weeks
**Key Outputs:**
- Brier score baseline report
- Slider adjustment improvement analysis
- Calibration audit (PIT test)
- Rules engine impact assessment

**Success Criteria (ALL MUST PASS):**
- [x] ≥30 projects with complete data
- [x] Brier_baseline in expected range (0.24-0.28)
- [x] ΔBrier_mean > 0.01 (showing improvement trend)
- [x] PIT KS test p-value > 0.05 (forecasts calibrated)
- [x] Rules engine not harmful

**Decision Gate:** PASS Phase 1 → Proceed to Phase 2

**If Phase 1 Partially Fails:**
- ΔBrier < 0.01: Investigate slider weight calibration; might need Phase 2 sensitivity analysis first
- KS test p-value < 0.05: Forecasts poorly calibrated; apply isotonic regression (Phase 2 item)
- Rules engine p-value < 0.10: Expand dataset; n=8 warned projects too small

---

## PHASE 2: ADVANCED ANALYSIS & CALIBRATION (Months 3-4)

### Test 2.1: Sensitivity Analysis (Morris Screening)
**Objective:** Rank slider importance; identify which sliders have largest effect on P(success)

**Method:**
1. Generate 50 random synthetic projects:
   ```
   For i=1 to 50:
     O ~ Uniform[1, 10]
     M ~ Uniform[O, O+10]
     P ~ Uniform[M, M+10]
   ```

2. For each of 7 sliders, compute Morris indices (μ*, σ*):
   - μ* = mean absolute effect of slider on final probability
   - σ* = standard deviation of slider effect (interaction measure)
   - Interpretation: High μ* = important slider; High σ* = non-linear/interactive

3. One-at-a-time variation:
   ```
   For each slider S_i:
     p_base = computeSliderProbability(O, M, P, {S=0 for all})
     p_low = computeSliderProbability(O, M, P, {S_i = 0, others = 0})
     p_high = computeSliderProbability(O, M, P, {S_i = 100, others = 0})
     effect_i = (p_high - p_low) / p_base
   ```

4. Repeat for 50 scenarios; collect effects
5. Compute Morris metrics:
   ```
   μ*_i = mean(|effect_i|)
   σ*_i = stdev(effect_i)
   ```

**Acceptance Criteria:**
- ✓ Ranking shows expected importance (Budget/Schedule > Rework > Confidence)
- ✓ Top 3 sliders account for ≥70% of variance
- ✓ No surprising reversals (e.g., Confidence shouldn't be most important)

**Effort:** 2 weeks (implementation + computation)
**Owner:** Data scientist / optimization researcher
**Output:** Morris ranking plot; importance table

**Expected Result:**
```
Morris Screening Results (50 synthetic projects):
Slider Importance Ranking:

1. budgetFlexibility       μ* = 0.187   σ* = 0.042  (Primary lever)
2. scheduleFlexibility     μ* = 0.134   σ* = 0.038  (Strong influence)
3. scopeCertainty          μ* = 0.098   σ* = 0.045  (Moderate, non-linear)
4. reworkPercentage        μ* = 0.076   σ* = 0.031  (Moderate)
5. riskTolerance           μ* = 0.043   σ* = 0.052  (Weak, interactive)
6. scopeReductionAllowance μ* = 0.031   σ* = 0.028  (Weak)
7. userConfidence          μ* = 0.012   σ* = 0.008  (Minimal direct effect)

Interpretation: Budget & schedule flexibility dominate risk model
(Aligns with PMBOK emphasizing schedule/budget as primary levers)
```

---

### Test 2.2: Distribution Alternative Comparison
**Objective:** When should we use Beta vs. Kumaraswamy vs. Johnson SU?

**Method:**
1. For each historical project, fit 3 distributions:
   - Beta: Standard PERT
   - Kumaraswamy: Alternative bounded
   - Johnson SU: Flexible skewed distribution

2. For each, compute KL divergence to "true" (empirical) distribution:
   ```
   empirical_CDF(actual) from historical data of similar projects
   kl_beta = KL(empirical || beta_fitted)
   kl_kumaraswamy = KL(empirical || kumaraswamy_fitted)
   kl_sj = KL(empirical || sj_fitted)
   ```

3. Logistic regression to predict which wins:
   ```
   winner = argmin(kl_beta, kl_kum, kl_sj)
   logistic: P(winner=SU | O,M,P,rework,scope_var) = 1 / (1 + exp(-X*β))
   ```

4. Decision rules:
   - If rework > 25%, use Kumaraswamy (better tail stability)
   - If scope_uncertainty > 0.6, use Johnson SU (captures skew)
   - Else use Beta (default)

**Acceptance Criteria:**
- ✓ Decision rules are interpretable
- ✓ Alternative distributions win 15-25% of cases (not negligible, but Beta primary)
- ✓ Logistic regression achieves >60% accuracy predicting winner

**Effort:** 3 weeks (fitting + analysis)
**Owner:** Statistician / distribution expert
**Output:** Decision tree/rules; accuracy metrics; diagnostic recommendations

**Expected Result:**
```
Distribution Fit Comparison (30 historical projects):

Beta wins: 22 projects (73%)
  - Mean KL divergence: 0.034
  - Median: 0.019
  - Range: [0.001, 0.156]

Kumaraswamy wins: 5 projects (17%)
  - Mean KL divergence: 0.022
  - Trigger: rework > 25% AND scope_certainty < 40%

Johnson SU wins: 3 projects (10%)
  - Mean KL divergence: 0.018
  - Trigger: schedule_flexibility > 75% (indicates long-tail upside)

Decision Rule Accuracy: 68% (logistic regression cross-validation)
```

---

### Test 2.3: Isotonic Regression (Calibration Improvement)
**Objective:** If Phase 1 showed poor calibration, apply post-hoc correction

**Method:**
1. If PIT KS test p-value < 0.05 (poorly calibrated):
   - Use isotonic regression to learn monotone recalibration function
   - Map forecast_probability | outcome → recalibrated probability
   - Fit on 50% of data; validate on holdout 50%

2. Isotonic regression:
   ```
   Goal: Find monotone function f such that
   f(forecast_prob) predicts outcome better
   Subject to: f is non-decreasing
   ```

3. Compute calibration metrics before/after:
   - ECE (Expected Calibration Error)
   - Reliability diagram distance
   - KS test p-value

**Acceptance Criteria:**
- ✓ ECE improves (lower after correction)
- ✓ KS test p-value > 0.05 after correction (uniformity restored)
- ✓ Correction doesn't overfit (similar performance on holdout)

**Effort:** 1.5 weeks
**Owner:** ML engineer / statistician
**Output:** Recalibration function; before/after metrics

**Expected Result:**
```
Isotonic Regression Calibration:

Before Correction:
  ECE: 0.082
  KS p-value: 0.034 (poorly calibrated)

After Correction:
  ECE: 0.019
  KS p-value: 0.237 (well-calibrated!)

Recalibration Function:
  f(p) ≈ 0.3 + 0.5*p (slopes lighter forecasts; steepens confidence)
```

---

## PHASE 2 Summary

**Total Effort:** 6-7 weeks
**Key Outputs:**
- Slider importance ranking (Morris)
- Distribution fit decision rules
- Calibration improvement (if needed)

**Success Criteria:**
- [x] Morris ranking sensible (Budget/Schedule > Rework >> Confidence)
- [x] Top 3 sliders explain ≥70% variance
- [x] Alternative distributions identified (15-25% win rate)
- [x] Calibration ECE < 0.05 (excellent)

**Decision Gate:** PASS Phase 2 → Prepare Phase 3

**Deliverable:** Technical report with findings; ready for paper draft

---

## PHASE 3: QUANTILE MODE & VISUALIZATION (Months 5-7)

### Test 3.1: Quantile-Based Adjustment Pilot
**Objective:** Validate quantile mode as complement to moment mode

**Method:**
1. Implement quantile-based reshaping (inverse CDF matching):
   - User specifies target P10, P50, P90
   - System fits distribution through these quantiles
   - Compare outcome to moment-based mode

2. A/B test on new projects:
   - Group A (n=5): Slider adjustments (current moment mode)
   - Group B (n=5): Quantile specification (new mode)
   - Measure time-to-decision, forecast accuracy

3. Metrics:
   - Decision time: minutes to converge on probability
   - User satisfaction: subjective rating (1-5)
   - Brier score: which mode produces better forecast?

**Acceptance Criteria:**
- ✓ Quantile mode doesn't take significantly longer
- ✓ Accuracy within 5% of moment mode (no degradation)
- ✓ Users find quantile mode intuitive (rating ≥3.5/5)

**Effort:** 3 weeks (1.5 implementation + 1.5 user testing)
**Owner:** UX/Dev + PM
**Output:** Quantile mode feature; A/B test report

---

### Test 3.2: Uncertainty Visualization Enhancement
**Objective:** Add distribution shape visualization (Kay et al., 2015 style)

**Method:**
1. Implement uncertainty band visualization:
   - Violin plot of adjusted distribution
   - Highlight P10, P50, P90 quantiles
   - Show how sliders shift distribution

2. Animated slider adjustment:
   - As user adjusts slider, distribution animates in real-time
   - Color intensity for confidence bands

3. User testing (n=10 non-expert users):
   - Do they understand visual?
   - Does it influence their slider choices?
   - Qualitative feedback

**Acceptance Criteria:**
- ✓ ≥80% users find visualization helpful
- ✓ No increase in decision time
- ✓ Visual doesn't mislead (checked against actual computations)

**Effort:** 2 weeks
**Owner:** UX/Frontend dev
**Output:** Enhanced visualization; user feedback report

---

## PHASE 3 Summary

**Total Effort:** 5-6 weeks
**Key Outputs:**
- Quantile adjustment mode
- Uncertainty visualization
- Enhanced user experience

**Success Criteria:**
- [x] Quantile mode implemented and tested
- [x] Visualization improves understanding without slowing decisions
- [x] User satisfaction >80%

---

## PHASE 4: ADVANCED METHODS & PUBLICATION (Months 8-12)

### Test 4.1: Bayesian Updating with Historical Priors
**Objective:** Enable teams to update PERT priors from their historical calibration

**Method:**
1. For each team, compute historical calibration factor:
   ```
   bias = mean(actual / estimated)
   confidence_interval = [bias - 1.96*se, bias + 1.96*se]
   ```

2. Use as Bayesian prior on next estimate:
   ```
   Prior: PERT(O, M, P) scaled by bias factor
   Likelihood: Expert sliders (reflect new information)
   Posterior: Updated distribution
   ```

3. Compare: Posterior vs. slider-only adjustment

4. Validation: Do historical prior-updated estimates improve accuracy?

**Acceptance Criteria:**
- ✓ Posterior is sensible (within team's historical range)
- ✓ Posterior + expert sliders outperform sliders alone (5-10% Brier improvement)
- ✓ Teams find feature intuitive

**Effort:** 3 weeks
**Owner:** Data scientist / Bayesian expert
**Output:** Bayesian mode feature; validation results

---

### Test 4.2: Info-Gap Robustness Scoring
**Objective:** Report how robust decisions are to estimation errors

**Method:**
1. For each project estimate, compute info-gap horizon:
   ```
   horizon = max(ε) such that decision remains viable
   e.g., "What's the max estimation error we can tolerate?"
   ```

2. For different goals:
   - Meet deadline: "Actual can be ε worse and still on time"
   - Stay on budget: "Cost can exceed estimate by ε"
   - Deliver quality: "Quality metrics within ε tolerance"

3. Report robustness score:
   - High robustness = project has slack (safe)
   - Low robustness = tight constraints (risky)

**Example:**
```
Project Robustness Summary:
Goal: Complete within P90 estimate
Robustness horizon: ε = 0.15 (15%)
Meaning: "Project succeeds even if actual duration is 15% longer than P90"
Rating: MODERATE (not much buffer)

Recommendation: Increase scope reduction allowance or schedule flexibility
```

**Acceptance Criteria:**
- ✓ Robustness score computed for each project
- ✓ Score correlates with actual project outcomes (risky projects flag early)
- ✓ Teams find recommendations actionable

**Effort:** 2 weeks
**Owner:** Decision analyst / researcher
**Output:** Robustness scoring module; validation report

---

### Test 4.3: Ensemble Forecasting with Multiple Experts
**Objective:** Validate multi-expert slider aggregation

**Method:**
1. Case study: 1 complex project with 3-5 subject matter experts
   - Each provides independent sliders
   - Test three aggregation methods:
     a) Simple average of slider values
     b) Clemen & Murphy (1999) Bayesian aggregation
     c) Current copula-based method

2. Compare:
   - Which aggregation method produces best Brier score vs. actual outcome?
   - Which experts' sliders were most accurate?
   - Do experts agree (low variance) or disagree (high variance)?

3. Generalize findings to other projects

**Acceptance Criteria:**
- ✓ Copula method ≥ Bayesian method ≥ simple average
- ✓ Disagreement among experts quantified (info gain measured)
- ✓ Method scales to 3-5 experts without degradation

**Effort:** 2 weeks
**Owner:** Research lead
**Output:** Ensemble study; best practices guide

---

### Test 4.4: Paper Preparation & Publication
**Objective:** Publish findings in academic venue

**Timeline:**
- Months 8-9: Draft paper (Results sections from Phase 1-3)
- Month 9: Internal review (2 rounds)
- Month 10: Revise for target venue (IEEE Software or EMSE)
- Month 11: Submit
- Month 12: Respond to reviewer feedback

**Paper Structure:**
1. Abstract: "Interactive copula-based distribution reshaping for project estimation"
2. Intro: Expert elicitation challenges; three-point estimation limitations
3. Methods: 7-slider system; copula aggregation; validation approach
4. Results: Phases 1-3 findings (Brier improvement, Morris ranking, distribution rules)
5. Discussion: Alignment with literature; limitations; future work
6. Conclusion: Implications for practice

**Target Venues:**
1. IEEE Software (practitioner-friendly)
2. Empirical Software Engineering (EMSE) (rigorous academic)
3. Journal of Software Engineering Research & Development

**Acceptance Criteria:**
- ✓ Paper submitted to peer-reviewed venue
- ✓ ≥2 rounds of constructive review
- ✓ Positive decision OR accept with minor revisions

**Effort:** 4-5 weeks (writing + revision)
**Owner:** Lead researcher + PM
**Output:** Peer-reviewed publication (or under review)

---

## PHASE 4 Summary

**Total Effort:** 11-13 weeks
**Key Outputs:**
- Bayesian prior integration feature
- Info-gap robustness scoring
- Ensemble forecasting evaluation
- Peer-reviewed publication

**Success Criteria:**
- [x] Bayesian mode improves accuracy 5-10%
- [x] Robustness scoring implemented and validated
- [x] Ensemble method proven superior to simple average
- [x] Paper accepted or under review at top venue

---

## OVERALL TIMELINE & RESOURCE PLAN

### Gantt Timeline
```
Phase 1: Historical Data Setup        ████ (Weeks 1-5)
Phase 2: Sensitivity Analysis          ████ (Weeks 3-10)
Phase 3: Quantile & Visualization      ████ (Weeks 5-11)
Phase 4: Advanced Methods & Paper      ████████ (Weeks 8-21)

Total Duration: 12 months
Gate Reviews: End of each phase (Weeks 5, 10, 16, 21)
```

### Resource Requirements

**Phase 1:**
- Data analyst (1 FTE, weeks 1-3)
- Statistician (0.5 FTE, weeks 3-5)

**Phase 2:**
- Data scientist (1 FTE, weeks 3-10)
- Statistician (0.5 FTE, weeks 8-10)

**Phase 3:**
- UX/Frontend developer (1 FTE, weeks 5-11)
- PM/User researcher (0.5 FTE, weeks 8-11)

**Phase 4:**
- Senior researcher (0.5 FTE, weeks 8-21, paper writing)
- Data scientist (0.5 FTE, weeks 11-15, Bayesian features)
- Decision analyst (0.5 FTE, weeks 15-18, info-gap)

**Total Budget:** ~12-14 person-months

---

## SUCCESS CRITERIA (OVERALL)

**PRIMARY METRIC:**
- [x] Brier score improvement ≥10% (target: 0.25 → 0.22 or better)

**SECONDARY METRICS:**
- [x] PIT uniformity test p-value > 0.05 (well-calibrated)
- [x] Morris screening identifies top 3 sliders explaining ≥70% variance
- [x] Alternative distribution decision rules identified (15-25% win rate)
- [x] Quantile mode implemented without accuracy loss
- [x] User satisfaction ≥80% for new features

**PUBLICATION GOAL:**
- [x] Manuscript submitted to peer-reviewed venue
- [x] Positive decision OR accept with minor revisions

**BUSINESS IMPACT:**
- [x] ProjectCare documented as evidence-based system
- [x] Customers can cite academic validation in governance reports
- [x] Team expertise recognized (potential consulting/training revenue)

---

## RISK MITIGATION

| Risk | Probability | Impact | Mitigation |
|------|---|---|---|
| Historical data incomplete | Medium | High | Start data collection immediately; accept n=20 if n=30 unavailable |
| Slider data missing | Medium | Medium | Validate against subset with available sliders |
| Phase 1 findings inconclusive (ΔBrier < 0.01) | Low | High | Investigate slider weight tuning (Phase 2 sensitivity analysis first) |
| Calibration poor (KS p < 0.05) | Medium | Medium | Apply isotonic regression (Phase 2 item); expected to fix |
| Morris ranking unexpected | Low | Low | Validate assumptions on synthetic data; sensitivity to parameter choices |
| Computer resources insufficient | Low | Low | Most computation is O(n²); feasible on standard hardware |
| Key personnel unavailable | Low | High | Cross-train; document procedures; modular deliverables |
| Publication rejected | Medium | Low | Resubmit to different venue; practice focus of first submission |

---

## DECISION GATES & GO/NO-GO CRITERIA

### End of Phase 1 (Week 5)
**PASS if:**
- ✓ ≥30 projects collected
- ✓ Brier_baseline in range [0.22, 0.28]
- ✓ No critical data quality issues

**DECISION:**
- PASS → Proceed to Phase 2
- CONDITIONAL PASS → Collect 10 more projects; recompute (1 week delay)
- NO PASS → Investigate data quality; may indicate estimation challenges not modeled

---

### End of Phase 2 (Week 10)
**PASS if:**
- ✓ Morris ranking shows sensible importance (Budget > Rework > Confidence)
- ✓ Top 3 sliders explain ≥70% variance
- ✓ Calibration improved to ECE < 0.05

**DECISION:**
- PASS → Proceed to Phase 3 (advanced features)
- CONDITIONAL → Apply calibration correction; retry Phase 1 tests (1-2 weeks)
- NO PASS → Refine moment model; revisit copula assumptions (high effort, deprioritize Phase 3-4)

---

### End of Phase 3 (Week 16)
**PASS if:**
- ✓ Quantile mode implemented & tested
- ✓ Visualization user testing ≥80% satisfaction
- ✓ No accuracy loss vs. moment mode

**DECISION:**
- PASS → Proceed to Phase 4 (publication, advanced methods)
- CONDITIONAL → Minor UX fixes; retry user testing
- NO PASS → Shelve quantile mode; focus on Phase 4 core features

---

### End of Phase 4 (Week 21)
**PASS if:**
- ✓ Paper submitted to recognized venue
- ✓ Bayesian & info-gap features tested
- ✓ Ensemble validation complete

**DECISION:**
- PASS → System is publication-ready; cite academic paper in marketing
- CONDITIONAL → Paper under review; continue research branch
- NO PASS → Compile technical report (internal use); archive validation data for future publication

---

## DOCUMENTATION DELIVERABLES

**Completed Each Phase:**

**Phase 1:**
- Data cleaning report
- Brier score baseline analysis
- Calibration audit (PIT test results)
- Rules engine impact assessment
- Phase 1 gateway review meeting slides

**Phase 2:**
- Morris sensitivity ranking report
- Distribution fit decision rules document
- Calibration improvement methodology
- Technical report (draft)

**Phase 3:**
- Quantile mode feature specification
- Visualization design document
- User testing report
- Phase 3 gateway review slides

**Phase 4:**
- Bayesian updating feature documentation
- Info-gap robustness guide
- Ensemble forecasting best practices
- Peer-reviewed paper (submitted or published)
- Final validation roadmap report

---

## COMMUNICATION & STAKEHOLDER UPDATES

**Monthly Technical Reviews:**
- PM + 2 researchers: Progress against milestones
- Duration: 1 hour
- Output: Blockers, resource adjustments, next steps

**Phase-End Steering Committee (Quarterly):**
- C-suite, PMO leadership, technical team
- Present: Key findings, business implications, next phase approvals
- Duration: 30-45 min

**Annual Publication Update:**
- Announce peer-reviewed publications
- Highlight validation results
- Plan conference presentations

---

## BUDGET ESTIMATE (12 months)

| Role | FTE-months | Cost (@$15k/FTE-month) | Notes |
|------|---|---|---|
| Data analyst | 2 | $30k | Phases 1-2 |
| Statistician | 3 | $45k | Phases 1-2, 4 |
| Data scientist | 3.5 | $52.5k | Phases 2-3, 4 |
| UX/Frontend | 1.5 | $22.5k | Phase 3 |
| PM/Research | 2.5 | $37.5k | Phases 1, 3, 4 |
| **Total** | **12.5** | **$187.5k** | ~$16k/month |

*Note: Use actual salary burdened rates; adjust for regional costs*

---

## KEY SUCCESS FACTORS

1. **Data Quality:** Invest time in historical data curation (Phase 1). Garbage in = garbage out.

2. **Expert Involvement:** Engage subject matter experts (PMs, estimators) in design review & user testing. Their insights are critical.

3. **Incremental Validation:** Each phase builds on previous. Don't skip gates; stop if findings don't support progression.

4. **Publication & Recognition:** Academic publication elevates credibility. Plan writing early (not last-minute).

5. **Practical Applicability:** Features proposed should be usable by practitioners. Test with real teams (Phase 3-4).

---

## APPENDIX: CODE IMPLEMENTATION CHECKLIST

### Phase 1 Code Requirements
- [ ] `computeBrierScore(forecast_array, outcome_array)` function
- [ ] `computePIT_histogram(cdf_values, actuals)` with KS test
- [ ] CSV data export from historical projects
- [ ] Brier computation script (batch analysis)

### Phase 2 Code Requirements
- [ ] `morrisScreening(scenarios, weights_to_test, compute_fn)` (simplified OAT)
- [ ] Distribution fitting functions (Beta, Kumaraswamy, SU)
- [ ] `computeKLDivergence()` for each distribution pair
- [ ] Logistic regression for distribution selection
- [ ] Isotonic regression calibration (if needed)

### Phase 3 Code Requirements
- [ ] `reshapeDistributionViaQuantiles()` function
- [ ] Visualization library integration (D3.js or SVG)
- [ ] Animated slider → distribution update
- [ ] Violin plot rendering

### Phase 4 Code Requirements
- [ ] `bayesianUpdate()` with prior + likelihood
- [ ] `computeInfoGapHorizon()` for robustness
- [ ] Multi-expert aggregation logic
- [ ] Ensemble validation script

---

**END OF VALIDATION ROADMAP**

**Next Steps:**
1. Present this roadmap to leadership for approval (timeline, budget)
2. Assign Phase 1 team (data analyst, statistician)
3. Begin historical data collection (Week 1)
4. Schedule Phase 1 gateway review (end of Week 5)

---

**Document Version:** 1.0
**Last Updated:** February 2026
**Status:** Ready for implementation planning
**Contact:** [Research Lead Name]
