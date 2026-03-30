# References & Bibliography

Academic papers, books, and industry sources that ground the ProjectCare system in research literature.

## Contents

### Comprehensive Bibliography
- **REFERENCES_ANNOTATED_BIBLIOGRAPHY.md** - 50+ papers with annotations (8,000 words)
  - Organized by research area
  - Key findings from each paper
  - Relevance to system design
  - Links between papers and implementation

### Additional References (Planned)
- **CITATIONS_BY_TOPIC.md** - Index organized by topic/concept
  - Quick lookup by research area
  - Cross-references between citations
  - Strength of evidence for each claim

- **INDUSTRY_CASE_STUDIES.md** - Real-world examples and applications
  - Companies using similar approaches
  - Lessons learned from practice
  - Implementation tips from industry

## Research Areas Covered

The bibliography covers papers from:

1. **Project Management & Estimation**
   - PMBOK guides and standards
   - Three-point estimating (PERT)
   - Risk management in projects
   - Expert judgment in estimation

2. **Probability Theory & Distributions**
   - Beta distribution theory
   - Moment matching methods
   - Maximum entropy principle
   - Distribution approximations

3. **Bayesian Methods**
   - Prior elicitation
   - Belief updating
   - Probability aggregation
   - Hierarchical models

4. **Copulas & Dependence**
   - Gaussian copulas
   - Archimedean copulas
   - Tail dependence
   - Multivariate distributions

5. **Ensemble & Aggregation Methods**
   - Expert opinion combination
   - Delphi methods
   - Ensemble forecasting
   - Consensus methods

6. **Uncertainty Quantification**
   - Risk and uncertainty in engineering
   - Sensitivity analysis
   - Monte Carlo methods
   - Numerical integration

7. **Forecast Evaluation**
   - Proper scoring rules
   - Brier score
   - Calibration assessment
   - Prediction intervals

8. **Decision Theory**
   - Rational decision-making
   - Expected utility
   - Loss functions
   - Optimization methods

9. **Psychological Aspects**
   - Cognitive biases in estimation
   - Overconfidence
   - Anchoring effects
   - Debiasing techniques

10. **Machine Learning & AI**
    - Neural networks for estimation
    - Ensemble learning
    - Bayesian networks
    - Transfer learning

## How to Use This Folder

### Finding Papers on a Specific Topic
1. Go to REFERENCES_ANNOTATED_BIBLIOGRAPHY.md
2. Use Ctrl+F to search for your topic
3. Read the annotation for relevance
4. Check "See Also" references if provided

### Understanding Paper Connections
1. Read CITATIONS_BY_TOPIC.md (when available)
2. Follow cross-reference chains
3. Understanding the "web" of related research

### Learning Best Practices
1. Start with overview papers (marked with ⭐)
2. Read foundational papers (marked with 🔧)
3. Explore specialized papers (marked with 🔬)
4. Apply to your context

### Supporting Claims in Writing
1. Find relevant citation in bibliography
2. Note page number and key quote
3. Use in your own writing with proper attribution
4. Build your literature review chain

## Citation Symbols in Bibliography

- ⭐ **Overview/Survey** - Start here for an area
- 🔧 **Foundational** - Seminal work or standard reference
- 🔬 **Specialized** - Deep dive into specific topic
- 📊 **Empirical** - Data-driven study or validation
- 💡 **Application** - Practical implementation example
- ⚠️ **Critical** - Important limitations or caveats

## Reading Strategies

### Strategy 1: Depth-First (Deep Understanding)
1. Pick a research area
2. Read the overview paper (⭐)
3. Read all related foundational papers (🔧)
4. Read specialized papers (🔬)
→ You'll be expert in that area

### Strategy 2: Breadth-First (System Understanding)
1. Skim all overview papers (⭐)
2. Read empirical papers most relevant to PMC system (📊)
3. Focus on application examples (💡)
→ You'll understand full research landscape

### Strategy 3: Quick Lookup (Just-In-Time)
1. Use Ctrl+F to find topic
2. Read relevant annotations
3. Follow cross-references as needed
→ Quick answers to specific questions

### Strategy 4: Publication Preparation
1. Read all papers in your area
2. Note key findings and disagreements
3. Identify gaps and opportunities
4. Build literature review section
→ Ready to write academic paper

## Key Papers to Start With

If you only read 5 papers, read these:

1. **PERT/Three-Point Estimation** - Understanding PERT formula
2. **Gaussian Copulas** - Understanding dependency modeling
3. **Proper Scoring Rules** - Understanding forecast evaluation
4. **Expert Elicitation** - Understanding judgment aggregation
5. **Beta Distribution** - Understanding our core distribution

See REFERENCES_ANNOTATED_BIBLIOGRAPHY.md for specific citations.

## Cross-References to Implementation

| Implementation | Papers | Location |
|--------|--------|----------|
| PERT formula | PMBOK, Hillier | architecture/MATH_AUDIT_REPORT.md |
| Beta distribution | Clemen, Louzada | research/distributions/RESEARCH_SYNTHESIS.md |
| Gaussian copula | Nelsen, Cherubini | research/distributions/COPULA_THEORY.md |
| Weight optimization | Keeney, Raiffa | research/pmbok/PMBOK_BUFFER_ANALYSIS.md |
| Moment matching | Smith, Grove | research/distributions/RESEARCH_SYNTHESIS.md |
| Brier score | Murphy, Epstein | research/validation/PROPER_SCORING_RULES.md |
| Expert aggregation | Clemen, Winkler | research/distributions/RESEARCH_SYNTHESIS.md |

## Document Statistics

| Document | Length | Papers | Time |
|----------|--------|--------|------|
| REFERENCES_ANNOTATED_BIBLIOGRAPHY.md | 8,000+ words | 50+ | 1.5-2 hrs |
| CITATIONS_BY_TOPIC.md (planned) | ~3,000 words | 50+ | 30-45 min |
| INDUSTRY_CASE_STUDIES.md (planned) | ~2,000 words | 10-15 | 20-30 min |
| **Subtotal** | **~13,000+ words** | **60+** | **3-4 hours** |

## When to Use This Folder

**Writing your own research:**
→ Use REFERENCES_ANNOTATED_BIBLIOGRAPHY.md for literature review

**Defending design choices:**
→ Use CITATIONS_BY_TOPIC.md to find supporting papers

**Learning best practices:**
→ Use overview papers (⭐) in each area

**Academic publication:**
→ Use full bibliography for comprehensive citations

**Training new team members:**
→ Create reading list from this folder + research/

**Exploring alternatives:**
→ Use papers marked 📊 and ⚠️ for evaluated alternatives

---

## Status

- [x] REFERENCES_ANNOTATED_BIBLIOGRAPHY.md - Complete (50+ papers)
- [ ] CITATIONS_BY_TOPIC.md - Planned
- [ ] INDUSTRY_CASE_STUDIES.md - Planned

---

**Last Updated**: February 15, 2026
**Total References**: 50+ academic papers fully annotated
**Coverage**: 10 research areas from estimation to AI/ML
**Next Step**: Read REFERENCES_ANNOTATED_BIBLIOGRAPHY.md or use Ctrl+F to find your topic
