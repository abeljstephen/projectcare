# PMBOK Research & Weight Justification

Project Management Body of Knowledge (PMBOK) analysis and justification of weight values used in the ProjectCare system.

## Contents

### Quick References
- **WEIGHT_VALIDATION_SUMMARY.md** - Start here (30-45 min)
  - What are the 7 weight values and why?
  - How do they map to PMBOK guidance?
  - Quick answer format with tables
  - ⚠️ NOW INCLUDES: "Alternative frameworks beyond PMBOK"

### Detailed Analysis
- **PMBOK_BUFFER_ANALYSIS.md** - Full technical dive (1-1.5 hours)
  - PMBOK Chapter 5 (Scope Management)
  - PMBOK Chapter 7 (Cost Management)
  - PMBOK Chapter 11 (Risk Management)
  - How buffer percentages translate to our weights
  - Section-by-section analysis with examples

- **PMBOK_FORMULA_REFERENCE.md** - Mathematical proofs (45 min)
  - Derivation of W from PMBOK buffers
  - Numerical examples
  - Validation against industry standards
  - Sensitivity to PMBOK parameter variations

- **ALTERNATIVE_WEIGHT_FRAMEWORKS.md** - Beyond PMBOK (1 hour) ⭐ NEW
  - Software estimation (COCOMO, Story Points)
  - Construction weighting models
  - Pharmaceutical trial estimation
  - Manufacturing/FMEA approaches
  - Financial risk models
  - Academic consensus on weighting
  - **Key finding**: No universal weights; context matters
  - **Conclusion**: Empirical validation (Phase 1) is the real proof

- **ANALYSIS.md** - Legacy analysis guide (Reference)
  - Alternative organization of similar content
  - May reference overlapping material

## Weight System Overview

The ProjectCare uses **7 weighted sliders** to capture project complexity:

```
W = [0.20, 0.20, 0.18, 0.15, 0.10, 0.09, 0.08]
    ↓     ↓     ↓     ↓     ↓     ↓     ↓
   Budget Schedule Scope  Scope  Rework Risk  User
  Flexibility Flexibility Certainty Reduction %  Tolerance Confidence
   (20%)   (20%)   (18%)   (15%)   (10%)   (9%)   (8%)
```

These sum to 1.0 and represent the **relative importance** of each factor in determining estimation accuracy.

## PMBOK Justification

Each weight is grounded in PMBOK guidance:

| Weight | PMBOK Source | Rationale | Buffer Range |
|--------|---|----------|----------|
| 0.20 (Budget) | Ch. 7, 11 | Cost buffer, reserve analysis | 15-25% |
| 0.20 (Schedule) | Ch. 6, 11 | Schedule buffer, time contingencies | 15-25% |
| 0.18 (Scope) | Ch. 5 | Scope certainty, requirements stability | 12-20% |
| 0.15 (Reduction) | Ch. 5, 7 | Rework potential, contingency reduction | 10-18% |
| 0.10 (Rework) | Ch. 8, 11 | Quality/rework percentage | 5-15% |
| 0.09 (Risk) | Ch. 11 | Risk tolerance, risk response planning | 5-12% |
| 0.08 (User) | Ch. 5, 13 | Stakeholder confidence, engagement | 5-10% |

## Reading Paths

### Quick Understanding (45 minutes)
1. This README (5 min)
2. WEIGHT_VALIDATION_SUMMARY.md (40 min)
→ You'll know: *What are the weights and why are they justified within PMBOK?*

### Broader Context (1.5 hours)
1. This README (5 min)
2. WEIGHT_VALIDATION_SUMMARY.md (40 min)
3. ALTERNATIVE_WEIGHT_FRAMEWORKS.md (45 min)
→ You'll know: *PMBOK is one framework among many; weights are hypotheses, not proven facts*

### Complete Understanding (2.5-3 hours)
1. This README (5 min)
2. WEIGHT_VALIDATION_SUMMARY.md (45 min)
3. PMBOK_BUFFER_ANALYSIS.md (1-1.5 hours)
4. PMBOK_FORMULA_REFERENCE.md (30 min)
5. ALTERNATIVE_WEIGHT_FRAMEWORKS.md (45 min - optional)
→ You'll know: *Every detail of weight derivation, strengths, and limitations*

### Data-Driven Path (Recommended now)
1. WEIGHT_VALIDATION_SUMMARY.md - Quick PMBOK overview (40 min)
2. ALTERNATIVE_WEIGHT_FRAMEWORKS.md - Why theory alone isn't enough (45 min)
3. Go to: `../../validation/VALIDATION_ROADMAP_IMPLEMENTATION.md` - Plan Phase 1 to determine ACTUAL optimal weights
→ You'll know: *Theories exist, now let's test with real data*

### Executive Approval (20 minutes)
1. WEIGHT_VALIDATION_SUMMARY.md - Executive Summary section (10 min)
2. ALTERNATIVE_WEIGHT_FRAMEWORKS.md - Part 4: "Why Theory Matters Less than Data" (10 min)
→ Decision: Approve Phase 1 validation to determine true weights?

## Key Questions Answered

**Q: Are these weights arbitrary?**
A: Not entirely. They're informed by PMBOK guidance and industry patterns. BUT they're not uniquely justified by any single framework. See ALTERNATIVE_WEIGHT_FRAMEWORKS.md for why multiple frameworks suggest different weight distributions.

**Q: Why these specific percentages (20%, 20%, 18%, etc.)?**
A: PMBOK provides buffer ranges (15-30%), and we selected values in the middle-to-conservative ranges. Other frameworks (software, construction, finance) suggest different distributions. See Part 4 of ALTERNATIVE_WEIGHT_FRAMEWORKS.md for cross-framework comparison.

**Q: Can weights be adjusted?**
A: Yes. But better approach: Use Phase 1 empirical data to determine OPTIMAL weights. See validation/VALIDATION_ROADMAP_IMPLEMENTATION.md.

**Q: What if our context is different from PMBOK?**
A: Excellent question. Different industries (software = COCOMO, construction, pharma) show different optimal weights. Phase 1 will discover YOUR optimal weights using YOUR project data.

## Cross-References

**For Architecture Context:**
- See `../../architecture/WEIGHT_SYSTEM.md` - How W, W_MEAN, and Hybrid blend work

**For Validation Methods:**
- See `../../validation/VALIDATION_ROADMAP_IMPLEMENTATION.md` - How to test these weights empirically

**For Alternative Weights:**
- See `../../calibration/CALIBRATION_LOG.md` - Track of weight changes over time
- See `../../calibration/SENSITIVITY_ANALYSIS.md` - Which weights actually matter?

**For Academic Grounding:**
- See `../distributions/REFERENCES_ANNOTATED_BIBLIOGRAPHY.md` - PMBOK citations + academic papers

## Document Statistics

| Document | Length | Time | Focus |
|----------|--------|------|-------|
| WEIGHT_VALIDATION_SUMMARY.md | 5,500 words | 30-45 min | Quick answer |
| PMBOK_BUFFER_ANALYSIS.md | 7,200 words | 1-1.5 hrs | Full analysis |
| PMBOK_FORMULA_REFERENCE.md | 3,300 words | 30-45 min | Math proofs |
| **Subtotal** | **16,000 words** | **3-4 hours** | Complete coverage |

## When to Read Each Document

**First Research Session?**
→ Read WEIGHT_VALIDATION_SUMMARY.md (30 min)

**Implementing the System?**
→ Read WEIGHT_VALIDATION_SUMMARY.md + PMBOK_BUFFER_ANALYSIS.md (1.5-2 hrs)

**Academic Paper / Publication?**
→ Read all three documents + cross-references (3-4 hrs)

**Defending Weights to Stakeholders?**
→ Use WEIGHT_VALIDATION_SUMMARY.md tables + PMBOK_BUFFER_ANALYSIS.md Section 1

**Calibrating/Adjusting Weights?**
→ Read PMBOK_BUFFER_ANALYSIS.md Section 4 + PMBOK_FORMULA_REFERENCE.md

---

**Last Updated**: February 15, 2026
**Status**: Complete research corpus with 3 complementary documents
**Next Step**: Read WEIGHT_VALIDATION_SUMMARY.md or choose your path above
