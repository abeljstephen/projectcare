# Alternative Weight Justification Frameworks

**Beyond PMBOK: Industry Models, Academic Frameworks, and Data-Driven Approaches**

---

## Executive Summary

The 7 weights in ProjectCare [0.20, 0.20, 0.18, 0.15, 0.10, 0.09, 0.08] are NOT uniquely justified by PMBOK. Multiple frameworks across industries show different weight distributions. This document explores credible alternatives and concludes that **Phase 1 empirical validation is the true validator—not prior theory.**

---

## Part 1: Industry Weighting Systems (Non-PMBOK)

### 1. Software Estimation: COCOMO Models

**Framework**: Constructive Cost Model (Boehm et al.)

**Why relevant**: Software projects have explicit cost multipliers for different factors

**Weight structure**:
```
COCOMO Cost Multipliers:
- Personnel capability: 0.70-1.66x (varies by factor importance)
- Product complexity: 0.70-1.65x
- Required reliability: 0.75-1.40x
- Database size: 0.93-1.16x
- Machine constraints: 0.87-1.15x
- Personnel experience: 0.70-1.17x
- Language maturity: 0.70-1.17x

→ NOT uniform; some factors 2x more important than others
→ Weights vary by project type (embedded vs. application)
```

**Insight**: Different projects require different weight distributions. COCOMO acknowledges this contextualization.

**Relevance to PMC**: Our 7 weights are uniform across project types. Should they vary?

---

### 2. Agile/Story Point Estimation

**Framework**: Feature complexity decomposition

**Common factor breakdown**:
- Complexity (40-50%): Technical difficulty, unknowns
- Effort (30-40%): Time to implement
- Risk (10-20%): Integration, dependencies
- Dependencies (5-10%): Blockers, sequencing

**Insight**: Agile heavily weights complexity & effort. Risk gets 10-20%, not 9%.

**Relevance to PMC**: Our Risk slider is 9%. Should estimates weight risk more heavily?

---

### 3. Construction/Civil Engineering

**Framework**: WBS (Work Breakdown Structure) with risk allocation

**Typical buffer distribution**:
```
Labor costs: 25-30% weight
Materials: 20-25% weight
Equipment: 15-20% weight
Contingency/Risk: 15-25% weight (varies heavily by project)
Management/Overhead: 10-15% weight
```

**Key discovery**: Risk contingency ranges 15-25%, not fixed at 9%.

**Relevance to PMC**: Construction shows risk weighting 2-3x higher than PMBOK/our system.

---

### 4. Pharmaceutical/Clinical Trial Estimation

**Framework**: Regulatory timeline + experimental uncertainty

**Factor weights**:
- Regulatory approval path: 30-40% (must follow fixed steps)
- Patient enrollment uncertainty: 20-30% (highly unpredictable)
- Data analysis variability: 10-15%
- Manufacturing readiness: 10-15%
- Market timing: 5-10%

**Key discovery**: Single factor (regulatory) can be 40% of estimate. Very different from uniform weighting.

**Relevance to PMC**: Some domains may justify heavily weighting one factor.

---

### 5. Manufacturing/Operations: FMEA Risk Scoring

**Framework**: Failure Mode & Effects Analysis (RPN = Severity × Occurrence × Detection)

**Weight structure**: Not prespecified weights, but multiplicative factors that dynamically weight importance

**Risk Priority Number (RPN)**:
```
Severity (1-10): How bad if it fails?
Occurrence (1-10): How likely?
Detection (1-10): Can we catch it?

RPN = S × O × D (range: 1 to 1000)
```

**Key discovery**: Weights are multiplicative (interactive), not additive. Factors matter more when combined.

**Relevance to PMC**: Our weights are additive. What if Budget × Risk matters more than Budget + Risk?

---

### 6. Financial/Insurance: Risk Weighting Models

**Framework**: Regulatory capital models (Basel III, Solvency II)

**Typical factor grouping**:
```
Credit Risk: 40-50%
Market Risk: 20-30%
Operational Risk: 15-20%
Liquidity Risk: 5-10%

→ These vary by institution & regulatory domain
```

**Key discovery**: Financial consensus weights Credit highly (40%+), but varies by context.

**Relevance to PMC**: No universal weighting scheme. Context matters.

---

## Part 2: Academic Frameworks

### 1. Multi-Criteria Decision Analysis (MCDA)

**Field**: Operations Research / Decision Theory

**Standard approaches**:
- **Analytical Hierarchy Process (AHP)**: Pairwise comparisons derive weights
- **TOPSIS**: Weighted distance to ideal solution
- **Value-focused thinking**: Derive weights from stakeholder preferences

**Key finding**: MCDA derives weights through stakeholder input, not theory.

**Relevance**: We conjured weights. MCDA suggests: ask experts, measure preferences, derive weights.

---

### 2. Expert Judgment Aggregation

**Academic consensus** (Clemen & Winkler, 2007; Armstrong, 1985):
```
Simple averaging often beats complex weighting
(Reason: Outliers weighted equally in simple average)

BUT:
- Accuracy of individual experts matters
- Domain-specific confidence varies
- Correlations between experts need modeling
```

**Key insight**: How we weight sliders may matter less than which sliders we include.

**Relevance**: Phase 1 should test: "Are 7 sliders optimal or too many?"

---

### 3. Forecast Combination

**Academic finding** (Bates & Granger, 1969; Clemen, 1989):

For combining multiple forecasts (F₁, F₂), optimal weights are:
```
w₁ = σ₂² / (σ₁² + σ₂²)
w₂ = σ₁² / (σ₁² + σ₂²)

→ Weight by INVERSE variance, not by importance
```

**Key insight**: Optimal weighting depends on forecast uncertainty, not on factor importance.

**Relevance**: Should we weight sliders by their variance, not by fixed weights?

---

### 4. Regression-Based Factor Importance

**Standard approach in prediction**:
```
Outcome ~ β₁·Budget + β₂·Schedule + β₃·Scope + ...

β coefficients = implicit weights derived from data
```

**Key finding**: True weights emerge from predicting outcomes, not from prior theory.

**Relevance**: Phase 1 should compute actual β coefficients, then use data-driven weights.

---

## Part 3: What the Weights Actually Are

### Our Current Narrative (PMBOK-Based)
> "Weights are justified by PMBOK buffer percentages"

**Problems**:
- Overstates certainty of PMBOK justification
- Doesn't acknowledge context-dependence
- PMBOK itself doesn't specify these exact values

### Better Narrative (Evidence-Based)
> "Initial weights [0.20, 0.20, 0.18, 0.15, 0.10, 0.09, 0.08] are informed by:
> - PMBOK buffer allocations (heuristic baseline)
> - Expert judgment on factor importance (subjective)
> - Software estimation models (contextual comparison)
> - Requirement: sum to 1.0 (constraint)
>
> **These weights are HYPOTHESES, not proven facts.**
>
> Phase 1 validation will:
> 1. Test if they improve forecast accuracy (Brier score)
> 2. Identify which weights actually contribute (sensitivity analysis)
> 3. Potentially revise weights based on empirical data"

---

## Part 4: Cross-Framework Comparison

### Do Weight Values Converge?

| Factor | PMBOK | COCOMO | Agile | Construction | Finance | Pharma |
|--------|-------|--------|-------|--------------|---------|--------|
| **Complexity/Scope** | 18% | 40-50% | 40-50% | 20-25% | - | - |
| **Effort/Cost** | 20% | 20-30% | 30-40% | 25-30% | - | - |
| **Risk/Contingency** | 9% | 10-15% | 10-20% | 15-25% | 15-20% | - |
| **Time/Schedule** | 20% | - | - | - | - | 30-40% |
| **Personnel/Expertise** | - | 20-30% | - | 10-15% | - | - |
| **Domain-Specific** | - | - | - | - | 40-50% | 30-40% |

**What converges?**
- Complexity weight: 18-50% (wide range)
- Risk weight: 9-25% (our 9% is low)
- Effort weight: 20-40% (our 20% is reasonable)

**What's clear?**
- No universal weights
- Risk weighting varies 3x across frameworks
- Domain context matters critically

---

## Part 5: Why This Matters for Phase 1

### Current Problem
We're defending weights theoretically, but theory is **weak and context-dependent**.

### Better Approach
**Use Phase 1 as the weight validator:**

```
Historical Project Data (30+ projects)
    ↓
Regression: Outcome ~ β₁S₁ + β₂S₂ + ... + β₇S₇
    ↓
Discover: "True" weights from data
    ↓
Compare to current weights
    ↓
If mismatch: Adjust and test in Phase 2
```

**Advantage**: Weights are grounded in **your actual project outcomes**, not generic theory.

---

## Part 6: Literature Summary by Topic

### Where Uniform Weighting (Like Ours) Appears
- Simple averaging in ensemble forecasting (but usually suboptimal)
- Default in multi-criteria analysis before elicitation
- Pragmatic when data is unavailable

**Consensus**: Uniform weighting is a starting point, not an endpoint.

### Where Weights Vary by Context
- COCOMO: By software type
- Construction: By project phase & uncertainty
- Finance: By institution & regulatory domain
- Pharma: By development stage

**Consensus**: Weights should be context-dependent.

### Where Weights Come from Data
- Regression: Coefficients from historical outcomes
- Forecast combination: Inverse-variance weighting
- FMEA: Empirical severity/occurrence distributions
- Calibration methods: Refined from test results

**Consensus**: Best weights come from your data, not generic theory.

---

## Part 7: Credible Sources to Cite

### Software Estimation
- Boehm, B. W. (1981). "Software Engineering Economics." Prentice-Hall.
- Jones, C. (2007). "Estimating Software Costs."

### Forecasting & Expert Judgment
- Clemen, R. T., & Winkler, R. L. (2007). "Aggregating point estimates." International Journal of Forecasting.
- Armstrong, J. S. (1985). "Long-range Forecasting." Wiley.
- Bates, J. M., & Granger, C. W. J. (1969). "The combination of forecasts." Journal of the Royal Statistical Society.

### MCDA
- Saaty, T. L. (1990). "Decision Making for Leaders." RWS Publications.
- von Winterfeldt, D., & Edwards, W. (1986). "Decision Analysis and Behavioral Research." Cambridge University Press.

### Construction Estimation
- Ashworth, A., & Hogg, K. (2007). "Willis's Practice and Procedure for Quantity Surveyors." Blackwell Publishing.
- AACE International. "Cost Estimate Classification System."

### Risk in Estimation
- Hillson, D., & Simon, P. (2007). "Practical Project Risk Management." Management Concepts.
- Chapman, C., & Ward, S. (2003). "Project Risk Management." Wiley.

---

## Recommendations Going Forward

### 1. **Reframe Weight Justification**
- **OLD**: "These weights are justified by PMBOK"
- **NEW**: "These weights are informed by multiple frameworks; Phase 1 validation will determine optimality"

### 2. **Update Documentation**
- Add section: "Weight System: Initial Heuristic, Not Proven Fact"
- Show table of alternative frameworks
- Emphasize Phase 1 as true validator

### 3. **Set Phase 1 Objectives**
Include explicit goal: **Discover true weights from data**
```
Phase 1 Objective 3: Weight Sensitivity
- Run Morris screening (in Phase 2, actually)
- Identify which weights contribute most
- Is 7-slider framework optimal?
- Should weights vary by project type?
```

### 4. **Plan Phase 2 to Optimize Weights**
```
Phase 2: Sensitivity Analysis & Optimization
- Morris screening: "Which sliders matter?"
- Regression: "What are optimal β coefficients?"
- Calibration: "Should weights vary by domain?"
- Result: Data-driven weight refinement
```

---

## Honest Assessment: What We Know vs. Don't Know

### ✅ We Know
- PERT formula is standard and correct
- Beta distribution is appropriate for 3-point estimates
- 7 factors capture real project variability
- Mathematical implementation is sound

### ❓ We Don't Know (Yet)
- **Are these weights optimal?** (Phase 1 will show)
- **Do weights vary by project type?** (Phase 2 will test)
- **Are all 7 sliders necessary?** (Sensitivity will reveal)
- **What's the actual impact on forecast accuracy?** (Brier score will measure)
- **Which factors truly predict outcomes?** (Regression will show)

### 🎯 What Phase 1 Actually Validates
Not: "PMBOK justifies these weights"
But: "Historical projects show these weights improve accuracy"

---

## Next Document: Data-Driven Weight Discovery

Once we have Phase 1 data, the next document should be:

**WEIGHT_OPTIMIZATION_RESULTS.md**
- Regression coefficients from 30+ projects
- Morris screening sensitivity indices
- Comparison: Theoretical weights vs. empirical weights
- Recommendation: Adjust weights based on data?

---

**Document Status**: New framework document
**Recommended Reading**: Before Phase 1 planning
**Key Takeaway**: Multiple frameworks exist. Ours is defensible but not unique. Empirical validation in Phase 1 is the real proof.

**When to Update**: After Phase 1 data collection, compute actual weights and replace theoretical justifications.
