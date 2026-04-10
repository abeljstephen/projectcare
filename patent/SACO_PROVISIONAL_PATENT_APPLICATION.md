# PROVISIONAL PATENT APPLICATION

**Title of Invention:**
SHAPE-ADAPTIVE COPULA OPTIMIZATION (SACO): A SYSTEM AND METHOD FOR
CONTEXT-AWARE PROBABILISTIC PROJECT DURATION ESTIMATION USING
GAUSSIAN COPULA MOMENT MAPPING WITH KL-DIVERGENCE CONSTRAINT,
BAYESIAN MCMC BASELINE UPDATING, USER-CONTROLLED WEIGHT ARCHITECTURE,
DIFFICULTY-ADAPTIVE LEASH PENALTY, ERF-BASED MONOTONE FEASIBILITY,
AMBITION DETECTION, AND PSD-STABILIZED CHOLESKY COPULA SAMPLING

**Inventor:**
Abel J. Stephen
iCareNOW.io

**Date of First Reduction to Practice:** March 2, 2026
**Date of Amendment (Claims 16–22 and Sections VII-D, X-A, X-B):** April 9, 2026
**Date of Amendment (Claims 23–25 and Sections II.C, IV, V, VI-B, XII-A, XIV-A, XVII):** April 9, 2026

**Filing Type:** Provisional Patent Application
**Subject Matter:** Computer-Implemented Method and System

---

## CROSS-REFERENCE TO RELATED APPLICATIONS

Not applicable.

---

## FIELD OF THE INVENTION

This invention relates to probabilistic project estimation systems, and
more specifically to a computer-implemented system and method for
context-aware reshaping of project duration probability distributions
using a multi-dimensional slider framework, Gaussian copula dependency
modeling, hybrid moment mapping, two-stage constrained optimization, and
Kullback-Leibler divergence-bounded distribution adjustment.

---

## BACKGROUND OF THE INVENTION

### The Problem With Standard PERT and Monte Carlo

Program Evaluation and Review Technique (PERT) is the dominant
probabilistic project estimation method. Given three values — Optimistic
(O), Most Likely (M), and Pessimistic (P) — PERT approximates the
distribution of project duration as a Beta distribution with:

    Mean (μ) = (O + 4M + P) / 6
    Variance (σ²) = ((P - O) / 6)²

Monte Carlo simulation extends PERT by sampling from this distribution
thousands of times to produce a probability density function (PDF) and
cumulative distribution function (CDF), enabling statements like:
"There is a 90% probability of completing within 22 days."

**Critical limitation:** Standard PERT and Monte Carlo are completely
context-blind. Given the same three-point estimate (O, M, P), the method
produces identical probability outputs regardless of:

- Whether the project budget has flexibility to absorb overruns
- Whether the delivery schedule is rigid or negotiable
- Whether requirements are firmly defined or subject to change
- Whether the team expects significant rework
- The organization's historical risk tolerance
- The practitioner's own confidence in their estimate

Two projects with identical O, M, P values but radically different
risk profiles receive identical probability outputs under standard PERT.
This is widely recognized as a deficiency in the project management
literature (PMI PMBOK Guide, 7th Ed.) but no systematic computational
solution has been published.

### The Decision-Uncertainty Boundary: Management Stance vs. Outcome Predictions

A second and equally fundamental limitation of standard PERT and Monte Carlo
is epistemic: the methods conflate two categorically distinct types of inputs
that practitioners routinely provide.

**Uncertain outcomes** are properties of the external world that the
practitioner cannot control — the inherent variability in task execution time,
subcontractor performance, material availability, and other aleatory sources.
These are properly represented as probability distributions and captured by
the O, M, P three-point estimate.

**Management stance** refers to the set of deliberate policy decisions and
organizational constraints that the project manager controls or commits to —
how much contingency reserve to hold, how tightly requirements are defined,
how much rework to plan for, the organization's risk appetite. These are
**decision variables** in the formal sense of Howard and Matheson's influence
diagram framework (Howard, 1968; Howard & Matheson, 1984): quantities whose
values are set by the decision maker, not sampled from a distribution.

The distinction between decision nodes (management stance) and chance nodes
(uncertain outcomes) is foundational in decision analysis and was formalized
in Howard's 1968 paper "The Foundations of Decision Analysis" and in the
influence diagram literature (Howard & Matheson, 1984). In this framework,
the probability distribution of project outcomes is properly understood as
a *conditional* distribution: P(duration | management stance). Standard PERT
ignores management stance entirely, computing P(duration) unconditionally.

Kahneman and Lovallo (2003) identified the practical consequence of this
conflation as the **planning fallacy**: practitioners systematically treat
their management commitments (scope will remain stable, rework will be
minimal) as though they were predictions about the world. The result is
systematic optimism bias — not because practitioners misestimate task
duration, but because they misstate their management stance as more favorable
than it proves to be in practice. Flyvbjerg (2008) documented this bias
empirically across thousands of infrastructure, IT, and engineering projects,
finding that the inside view — which treats management quality as given and
optimistic — systematically underestimates actual outcomes.

Chapman and Ward (2003) formalized "controllable conditions" as a distinct
category within project uncertainty management, arguing that sources of
uncertainty include not only variability and hazard (discrete risk events)
but also **ambiguity** — uncertainty that arises directly from management
decisions about scope definition, priority setting, and resource commitment.
The PMBOK Guide (6th Ed., §11.3.2.3) operationalizes this as the
**controllability** attribute of each identified risk: the degree to which
the project manager can influence the risk's probability and impact.

Spetzler and Staël von Holstein (1975) further established that the act of
eliciting probability distributions from practitioners is an elicitation of
**states of knowledge** — subjective beliefs about uncertain outcomes — which
are properly distinguished from **preference statements** and **policy
commitments** about what the decision maker intends to do. User confidence
(one of the seven SACO parameters) is precisely this: a calibration
correction on the practitioner's state of knowledge, not a prediction about
the world. Hubbard (2014) demonstrated that calibration — the degree to which
stated confidence intervals contain true values at their stated frequency —
is measurable and improvable, and that miscalibrated confidence is a primary
driver of project cost and schedule overrun.

The SACO framework operationalizes this theoretical distinction computationally
for the first time in a practical project estimation system. The seven
project characteristic parameters (the "slider vector") are explicitly
classified as **decision nodes** — management stance inputs — that condition
the outcome distribution, rather than additional uncertain quantities to be
sampled. The Gaussian copula models the joint dependency structure of these
management decisions, recognizing that budget flexibility, schedule
flexibility, and scope certainty are not organizationally independent choices.
The KL divergence constraint ensures that no management stance, however
favorable, can cause the system to produce a distribution that contradicts
the practitioner's own learned judgment embedded in O, M, P.

Howard's **clarity test** (1968) provides the formal criterion for this
classification: a quantity passes the clarity test if an omniscient but
non-interpretive observer could determine its value independent of the
practitioner's choices. O, M, P pass — they represent states of the external
world. Budget flexibility, scope certainty, and rework tolerance fail — their
values are determined entirely by practitioner intent and organizational
policy. Quantities that fail the clarity test are decision nodes, not chance
nodes, and must not be treated as uncertain random variables in a
well-formed decision model.

This theoretical grounding distinguishes SACO from all prior parametric
adjustment approaches, which either treat management conditions as ad hoc
buffer additions (no formal framework) or ignore management stance entirely
(standard PERT/MC). SACO is, to the inventors' knowledge, the first system
to formally separate the decision node space (management stance) from the
chance node space (outcome uncertainty) in a computational project estimation
framework.

### Existing Approaches and Their Limitations

**Parametric adjustment (ad hoc buffers):** Practitioners manually add
buffer to P. This is subjective, inconsistent, and does not produce
a principled probability redistribution.

**Bayesian updating:** Conventional Bayesian updating requires structured
historical project data and typically assumes a fixed parametric form for
the likelihood. When N is small (fewer than 10 projects), the posterior
is dominated by the prior and provides little discriminative power. No
existing system provides a lightweight conjugate Bayesian update path that
gracefully degrades to standard PERT estimation when no history is available.

**Neural network surrogates:** Require training data, are black boxes
with no theoretical justification, and suffer from overfitting. They
cannot be validated against first principles.

**Fuzzy logic systems:** Less principled than probabilistic approaches
and harder to validate or audit.

**Quantile-based adjustment:** Breaks the PERT foundation by abandoning
the three-point estimate structure.

**Wasserstein distance:** More computationally complex than KL divergence
with similar results; impractical in browser/cloud environments.

**Empirical copulas:** Require 30–100 historical projects with consistent
measurement. Not feasible for general-purpose project estimation.

No prior system has combined Gaussian copula dependency modeling,
hybrid probabilistic moment mapping, and KL divergence-bounded
two-stage optimization into a unified, data-free distribution
reshaping framework for project duration estimation.

---

## SUMMARY OF THE INVENTION

The present invention, termed **Shape-Adaptive Copula Optimization
(SACO)**, is a computer-implemented system and method that addresses the
context-blindness of standard PERT/Monte Carlo estimation by:

1. **Accepting a PERT three-point estimate** (O, M, P) as the baseline
   uncertainty model, preserving the practitioner's learned judgment.

2. **Accepting seven project characteristic parameters** (sliders)
   classified as management stance inputs — decision nodes in the
   Howard-Matheson influence diagram formalism — representing budget
   flexibility, schedule flexibility, scope certainty, scope reduction
   allowance, rework percentage, risk tolerance, and user confidence.
   These are explicitly distinguished from the outcome uncertainty
   encoded in O, M, P: their values are set by the practitioner as
   policy commitments, not sampled from a distribution.

3. **Modeling realistic dependencies** between the seven parameters using
   a Gaussian copula with a project-management-theoretic correlation
   matrix, rather than assuming independence.

4. **Computing adjusted distribution moments** via a hybrid function
   combining linear weighted aggregation and probabilistic disjunction
   (Murphy's Law formulation), with the interpolation weight dynamically
   determined by the copula coupling coefficient.

5. **Applying a two-stage optimization** (Latin Hypercube Sampling global
   search followed by COBYLA local refinement) to find the slider
   configuration that maximizes the probability of completion at the
   target value subject to a Kullback-Leibler divergence constraint.

6. **Repositioning the target value's percentile** within the reshaped
   distribution without modifying the original O, M, P estimate values —
   producing higher confidence at the same estimate when project context
   supports it.

**Key insight:** SACO does not change the point estimate. It
recontextualizes confidence at that estimate based on project
characteristics. A practitioner who estimates 22 days receives not just
a single probability but a context-adjusted probability that reflects
whether their project has the flexibility, certainty, and risk profile
to support higher or lower confidence in that number.

---

## BRIEF DESCRIPTION OF DRAWINGS

**FIG. 1** — System architecture diagram showing the seven-layer SACO
pipeline from user input to reshaped probability distribution.

**FIG. 2** — The seven-dimensional project characteristic slider
interface showing normalized [0,1] parameter space.

**FIG. 3** — Gaussian copula correlation matrix (BASE_R) with
project-management-theoretic cross-dimensional dependencies.

**FIG. 4** — Hybrid moment mapping diagram showing the linear
aggregation path, probabilistic disjunction path, and copula-weighted
interpolation producing m0 (mean adjustment) and m1 (variance
adjustment).

**FIG. 5** — Two-stage optimization flow: Latin Hypercube Sampling
(global exploration) → COBYLA local refinement, with KL divergence
penalty in the objective function.

**FIG. 6** — Percentile repositioning illustration: same target value
(22 days) moves from 90th to 95th percentile as project context
improves, with baseline distribution preserved.

**FIG. 7** — KL divergence safety tether: graphical illustration of
maximum allowed reshaping (~5%) relative to baseline distribution.

**FIG. 8** — Full user interface of the ProjectCare implementing SACO,
showing PDF/CDF charts, slider panel, target query, and report system.

**FIG. 9** — Metropolis-Hastings MCMC Bayesian baseline extension:
Student-t(ν=4) prior combined with Normal likelihood; MH chain trace
showing burn-in discard (first 500 iterations), thinning-by-5, and
convergence to posterior; chain-driven overrun injection diagram showing
how 1000 effective chain samples cycle through per PERT draw to produce
a right-shifted, wider, outlier-robust baseline distribution relative
to standard PERT.

**FIG. 10** — User-controlled weight architecture: four-tier progressive
disclosure UI showing Tier 1 (always visible: O/M/P, sliders, mode),
Tier 2 (run popover: optimize-for, KL weight, leash, probe level),
Tier 3 (advanced: PERT λ, KDE smoothing, copula preset), Tier 4
(methodology footnotes in report export).

**FIG. 11** — "Why This Result?" optimizer explainer panel showing the
three objective-function forces (target hit, baseline fidelity, leash)
as proportional bars, and per-slider movement table comparing user values
vs. SACO-recommended values with direction indicators.

**FIG. 12** — Influence diagram illustrating SACO's two-category input
architecture in the Howard-Matheson formalism: decision nodes (rectangles)
representing S₁–S₇ management stance parameters, feeding into the Gaussian
copula dependency layer; chance node (oval) representing the project duration
outcome distribution; and value node representing P(duration ≤ τ). Arrows
show the conditional dependency structure: the outcome distribution is a
function of both the three-point estimate (aleatory uncertainty) and the
management stance vector (decision node inputs). No prior project estimation
system has represented this conditional structure explicitly in its
computational architecture.

---

## DETAILED DESCRIPTION OF THE INVENTION

### I. SYSTEM OVERVIEW

The SACO system is implemented as a software pipeline executable in
cloud or browser environments. In the preferred embodiment, the system
operates as a Google Workspace Add-on within Google Sheets, but the
method is platform-independent and applicable to any computing
environment capable of floating-point arithmetic and basic linear
algebra operations.

The pipeline consists of seven sequential computational stages:

    Stage 1: Baseline Generation
    Stage 2: Latin Hypercube Sampling
    Stage 3: Warm Start (Grid Evaluation)
    Stage 4: Grid Search
    Stage 5: COBYLA Refinement
    Stage 6: Feasibility and Robustness
    Stage 7: Output and Probability Computation

Each stage is described in detail below.

---

### II. INPUT PARAMETERS

#### A. Three-Point Estimate (PERT Basis)

The system accepts three scalar inputs representing the practitioner's
duration estimate:

    O = Optimistic duration (units: days, hours, weeks, or any linear unit)
    M = Most Likely duration
    P = Pessimistic duration
    Constraint: O ≤ M ≤ P

These define the PERT baseline distribution:

    μ_base = (O + 4M + P) / 6         [PERT mean]
    σ²_base = ((P - O) / 6)²          [PERT variance]

#### B. Target Value (τ)

A scalar value τ within or near the range [O, P] at which the system
computes P(duration ≤ τ). The target may also be expressed as a
probability (inverse query mode), in which case the system returns
the value τ achieving that probability.

#### C. Seven Project Characteristic Parameters (The Slider Vector)

**Theoretical basis:** The seven parameters below are classified as
**decision nodes** in the Howard-Matheson influence diagram formalism
(Howard & Matheson, 1984) — quantities set by the project manager as
policy commitments, not uncertain quantities to be sampled from a
distribution. Each parameter represents a **controllable condition**
(Chapman & Ward, 2003; PMBOK §11.3.2.3) that conditions the project
outcome distribution: P(duration | S₁,...,S₇). This is the formal
basis for treating these parameters separately from the three-point
estimate O, M, P, which represent the practitioner's probability
encoding of uncertain outcomes (Spetzler & Staël von Holstein, 1975).

The system accepts a seven-dimensional vector **S** = (S₁, S₂, S₃, S₄,
S₅, S₆, S₇) where each component is normalized to [0, 1]:

    S₁ = Budget Flexibility
         [0 = fixed budget, no overrun tolerance]
         [1 = fully flexible budget]
         Weight w₁ = 0.20 (PMBOK cost management importance)

    S₂ = Schedule Flexibility
         [0 = hard deadline, no slip allowed]
         [1 = fully negotiable delivery date]
         Weight w₂ = 0.20 (PMBOK schedule management importance)

    S₃ = Scope Certainty
         [0 = requirements undefined, high change likelihood]
         [1 = requirements frozen, no scope creep expected]
         Weight w₃ = 0.18 (PMBOK scope management importance)

    S₄ = Scope Reduction Allowance
         [0 = all scope is mandatory]
         [1 = large fraction of scope is negotiable/deferrable]
         Weight w₄ = 0.15

    S₅ = Rework Percentage
         [0 = no rework expected]
         [0.5 = 50% of work expected to be redone]
         Weight w₅ = 0.10
         NOTE: Rework is a negative factor; higher S₅ degrades distribution

    S₆ = Risk Tolerance
         [0 = risk-averse organization]
         [1 = high risk tolerance]
         Weight w₆ = 0.09

    S₇ = User Confidence
         [0 = practitioner has low confidence in their estimate]
         [1 = practitioner has high confidence in their estimate]
         Weight w₇ = 0.08

    Constraint: Σwᵢ = 1.00

The weight vector W and all associated per-slider constraints are
specified in full in Section II.D below, including the mechanical role
of each value in the computational pipeline, the empirical literature
supporting each parameter's direction and magnitude, and an explicit
disclosure of which values are empirically grounded versus calibrated
as initial-version heuristics subject to recalibration via reference
class data.

#### C. Slider Functional Taxonomy

The seven management stance parameters are classified into five
functional categories based on what organizational capability they
represent. This taxonomy is exposed in the system's explanatory
outputs (counter-intuition warnings, recommendations, and report exports)
to help practitioners reason about which type of lever to adjust:

| Slider | Category | Organizational Basis |
|---|---|---|
| S₁ Budget Flexibility | **capacity** | Financial resource availability |
| S₂ Schedule Flexibility | **capacity** | Temporal resource availability |
| S₃ Scope Certainty | **certainty** | Definitional clarity of deliverables |
| S₄ Scope Reduction Allowance | **process** | Formal change control and trade-off policy |
| S₅ Rework Percentage | **process** | Quality management and defect remediation |
| S₆ Risk Tolerance | **behavioral** | Organizational risk appetite and culture |
| S₇ User Confidence | **other** | Practitioner epistemic self-assessment |

**Category definitions:**
- **capacity**: Levers that represent available project resources
  (money, time). These can often be adjusted directly through
  organizational decisions about budget and schedule.
- **certainty**: Levers representing how well-defined the project
  deliverables are. Low certainty cannot be resolved by resource
  additions alone — it requires requirements engineering work.
- **process**: Levers representing formal management practices and
  governance policies. Scope reduction requires approval processes;
  rework reduction requires quality practices.
- **behavioral**: Levers representing organizational culture and
  attitudes that are difficult to change in the short term. Risk
  tolerance is primarily a cultural attribute, not a policy switch.
- **other**: S₇ is unique because it reflects the practitioner's
  personal epistemic state about the estimate quality, not an
  organizational stance. It is categorized separately to flag that
  it is systematically discounted (smallest weight, smallest
  feasibility coefficient) based on calibration literature findings
  that self-reported confidence is overestimated by 40–50%
  (Hubbard 2007).

---

#### D. Slider Weight and Constraint Calibration Table

Each of the seven slider parameters carries four distinct numerical
specifications used at different stages of the SACO pipeline:

1. **Blend weight W** — used in the linear aggregation path of
   `computeAdjustedMoments()` to weight each slider's contribution
   to the hybrid mean moment m₀. W sums to 1.00 across all seven
   parameters.

2. **Signed moment weight W_MEAN** — used in the thesis-path (hybrid
   blend component) to determine the *direction* and relative magnitude
   of each slider's contribution to the mean shift. Negative values
   indicate that a higher slider value shifts the distribution mean
   downward (favorable); positive values shift it upward (unfavorable
   for cost/duration, representing a widening or stabilizing effect).

3. **Internal optimizer bounds (lo, hi)** — the search space
   boundaries enforced during the two-stage LHS + COBYLA optimization.
   Lower bounds (lo > 0) prevent the optimizer from claiming a
   parameter can be set to zero in any feasible plan; upper bounds
   (hi < 1.0) prevent the optimizer from exploiting unrealistic
   maximum values. Bounds are derived from the sign of W_MEAN: sliders
   with negative W_MEAN (favorable when high) carry lo = 0.15 to floor
   the optimizer above zero; sliders with positive W_MEAN carry
   hi = 0.70 to cap optimistic claims. reworkPercentage carries an
   additional hard cap of hi = 0.50 reflecting the empirical ceiling
   on rework as a fraction of project effort.

4. **Monotone feasibility coefficient** — the scaling factor applied
   to O, M, or P in the feasibility check that ensures the adjusted
   estimate maintains the ordering O < M < P after slider-induced
   reshaping. These coefficients represent the maximum effect each
   slider can exert on each PERT bound.

The table below documents all four specifications for each slider,
the stage(s) of the pipeline in which each is applied, the direction
of effect, and the empirical literature supporting the parameter's
inclusion and calibration. Where a specific numerical value is not
derivable from a published study, this is stated explicitly; such
values are disclosed as initial-version calibrations consistent with
published qualitative guidance and subject to recalibration via the
user's own reference class data (see Section III-A, Bayesian MCMC
baseline).

---

**TABLE 1: Slider Weight, Constraint, and Empirical Calibration Reference**

| Slider | UI Domain | Internal Bounds (lo, hi) | Blend Weight W | Signed Weight W_MEAN | Feasibility Coefficient | Pipeline Stage(s) | Effect Direction | Empirical Anchor — Direction | Empirical Anchor — Magnitude | Calibration Status |
|---|---|---|---|---|---|---|---|---|---|---|
| **S₁ Budget Flexibility** | 0–100 | lo=0.15, hi=1.0 | 0.20 | −0.20 | −20% on optimistic bound: `adjO × (1 − S₁ × 0.20)` | Stages 3–5 (moment computation, optimization bounds, feasibility) | Higher → lower expected duration/cost; wider feasible outcome region | PMBOK §7.4 (contingency reserves as a formal cost management practice); Flyvbjerg (2004): cost overruns range 20–75% by project type; PMI Pulse 2018: 9.9% of investment lost to poor performance | 0.20 coefficient is conservative relative to Flyvbjerg data (IT mean overrun: 73%); represents a marginal per-unit adjustment, not sector-specific calibration; 0.15 lower bound prevents degenerate zero-flexibility assumptions | **Direction: empirically grounded. Magnitude: calibrated heuristic** consistent with the lower range of documented cost overrun data; recommended for recalibration against practitioner's sector-specific reference class |
| **S₂ Schedule Flexibility** | 0–100 | lo=0, hi=0.70 | 0.20 | +0.10 | +10% on most likely bound: `adjM × (1 + S₂ × 0.10)` | Stages 3–5 | Higher → higher accepted most-likely duration; optimizer bounded to 70% max | Flyvbjerg, Holm & Buhl (2003, *Transportation Planning and Technology*, 258 projects): 23% average schedule overrun; Goldratt (1997) Critical Chain: project buffer = 50% of trimmed critical chain; PMBOK §6.6 schedule compression techniques | 10% coefficient is conservative vs. observed overrun data (23–70%); equal weight with budgetFlexibility (0.20) reflects a symmetry assumption, not an empirically derived relative importance; hi=0.70 prevents optimizer from claiming full schedule flexibility | **Direction: empirically grounded. Magnitude: calibrated heuristic.** The 10% coefficient may be increased in future versions based on sector-specific schedule overrun reference class data |
| **S₃ Scope Certainty** | 0–100 | lo=0, hi=0.70 | 0.18 | +0.30 | +30% on pessimistic bound: `adjP × (1 + S₃ × 0.30)` | Stages 3–5 | Higher → wider distribution (pessimistic bound confirmed as real, not an artifact of ambiguity); largest signed moment weight in the model | Construction Industry Institute PDRI (140 capital projects, ~$5B total value): 6–21% cost and schedule performance differential between high- and low-definition scope projects; PMI Pulse 2018: 52% of projects experience scope creep; Chapman & Ward (2003) *Project Risk Management*: scope ambiguity as primary continuous risk driver | 30% pessimistic-bound coefficient is within the upper range of the CII PDRI differential (6–21%) when fat-tail effects are included; W_MEAN = +0.30 is the largest signed weight, reflecting the CII finding that scope definition quality explains more cost variance than any other single management factor | **Best-supported coefficient in the model.** Direction and approximate magnitude are grounded in CII PDRI empirical data. The 0.18 blend weight and 0.30 feasibility coefficient are the most defensible quantitative claims in SACO |
| **S₄ Scope Reduction Allowance** | 0–100 | lo=0.15, hi=1.0 | 0.15 | −0.15 | −15% on optimistic bound: `adjO × (1 − S₄ × 0.15)` | Stages 3–5 | Higher → lower expected outcome (willingness to cut scope reduces expected duration/cost); symmetric with budgetFlexibility in bound structure | PMI scope risk literature; EVM scope contingency guidance (PMBOK §5.6 scope control); Chapman & Ward (2003): scope reduction as a formal contingency response | **No direct empirical study separates scope reduction allowance as a continuous management dimension and measures its effect on project duration distributions.** The 0.15 weight and coefficient are symmetric with budgetFlexibility by design; 0.15 lower bound prevents zero-reduction-allowance assumptions in optimization; this parameter is disclosed as a design decision grounded in qualitative PM literature rather than a specific quantitative study |
| **S₅ Rework Percentage** | **0–50** (not 0–100) | lo=0.15, hi=0.50 | 0.10 | −0.08 | −8% on most likely bound via inverted value: `adjM × (1 − S₅_inverted × 0.08)` | Stages 2–5 (inverted before copula; bounds enforced in optimization) | Higher UI value → more rework → degraded distribution; **parameter is inverted** before internal processing: `S₅_internal = 1 − (UI_value / 50)` | Boehm (1981) COCOMO: defect removal = 30–40% of software development effort; CII construction benchmarks: rework = 5–20% of contract value; Crosby (1979) *Quality is Free*; Juran (1988) quality cost data: internal failure (rework) = 25–40% of total quality cost | **Domain cap of 50% is strongly empirically supported**: software rework ceiling is empirically ~50% of effort; construction ~20%; no cross-industry study documents rework exceeding 50% of total project budget. The 50% domain cap is the most directly literature-validated numerical decision in SACO. The 0.10 weight and 0.08 feasibility coefficient are calibrated heuristics | **Domain (0–50): empirically grounded. Weight and coefficient: calibrated heuristics** |
| **S₆ Risk Tolerance** | 0–100 | lo=0, hi=0.70 | 0.09 | +0.25 | +25% on pessimistic bound: `adjP × (1 + S₆ × 0.25)` | Stages 3–5 | Higher → wider pessimistic bound (organization willing to accept worse outcomes); large signed moment weight but small blend weight reflects that risk tolerance widens the tail without dominating the mean | ISO 31000:2018 §6.3.4 (risk appetite as a formal risk management parameter); PMBOK 6th Ed. §11.3 (risk tolerance as a quantitative risk analysis input); Kahneman & Tversky (1979) prospect theory: loss aversion coefficient ~2:1; IZA Discussion Paper 15043 (2022, 1M+ employee-firm observations): risk-averse managers 30–37% less likely to accept risky resource commitments | **hi=0.70 cap is heuristic**: no study derives a 70% ceiling for risk tolerance. The 0.25 feasibility coefficient (largest pessimistic-bound effect in the model) is calibrated to produce moderate distribution widening; the 0.09 blend weight reflects that stated risk tolerance has modest but non-trivial predictive power relative to structural factors. These values are disclosed as heuristics consistent with ISO 31000 qualitative guidance |
| **S₇ User Confidence** | 0–100 | lo=0, hi=0.70 | 0.08 (smallest) | +0.05 (smallest) | +5% on most likely bound: `adjM × (1 + S₇ × 0.05)` | Stages 3–5 | Higher → marginally higher most-likely estimate; intentionally smallest effect in the model; self-reported confidence receives minimal distributional influence | Hubbard (2007) *How to Measure Anything*: uncalibrated 90% confidence intervals contain the true value only ~50% of the time; stated confidence should be discounted by ~40–50%; Kahneman & Lovallo (2003) planning fallacy: only 30% of subjects completed tasks within their own predicted time; Spetzler & Staël von Holstein (1975, *Management Science* 22:3): systematic overconfidence as the primary bias in expert probability elicitation | **The design decision (smallest weight, smallest coefficient) is strongly supported by the calibration literature.** Stated confidence is systematically overestimated by 40–50% in empirical studies; assigning it the smallest weight and smallest feasibility coefficient is directly consistent with Hubbard's calibration findings. The specific values (0.08, 0.05) are calibrated to produce conservative influence; the exact numbers are heuristic but the order of magnitude is literature-grounded |

---

**TABLE 2: Correlation Matrix BASE_R — Structure and Empirical Basis**

The Gaussian copula uses a 7×7 correlation matrix BASE_R to model
joint dependency between the seven management stance parameters. No
published empirical study provides a complete correlation matrix for
these specific management dimensions. The matrix values below are
calibrated based on the literature cited; where no empirical anchor
exists, this is stated explicitly.

| Factor Pair | BASE_R Value | Empirical Range in Literature | Literature Source | Calibration Status |
|---|---|---|---|---|
| S₁ Budget – S₂ Schedule (ρ₁₂) | 0.40 | 0.50–0.70 (cost-schedule co-movement in infrastructure) | Flyvbjerg (2003): strong co-movement of cost and schedule overruns; Touran & Wiser (1992, *ASCE JCEM* 118:2): empirical cost-schedule correlations | **Conservative relative to literature.** Empirical data suggest 0.55 would be better-supported; 0.40 is a deliberate conservative calibration |
| S₃ Scope – S₄ Scope Reduction (ρ₃₄) | 0.35 | Not directly measured as a pair in published literature | CII PDRI: shared variance with scope definition domain; Chapman & Ward (2003): structural relationship between scope ambiguity and reduction tolerance | **Plausible structural correlation.** Same conceptual domain; magnitude not independently anchored in a published study |
| S₆ Risk Tolerance – S₇ User Confidence (ρ₆₇) | 0.25 | No published correlation matrix for management attitude dimensions | — | **Heuristic.** No empirical study measures the correlation between risk appetite and self-reported confidence in project management settings |
| S₅ Rework — negative correlations with S₃ and S₇ | −0.10 each | Directionally supported | Juran quality cost theory; Boehm (1981): high rework rates inversely associated with scope definition quality and estimator confidence | **Direction supported; magnitude heuristic** |
| All other off-diagonal cells | 0.00–0.10 | Within Touran (1997, *ASCE JCEM* 123:3) activity correlation range of 0.2–0.6 | Touran (1997): rank correlations between construction cost activities | **Within empirical range; individual values are heuristic** |

The overall correlation matrix structure — moderate positive correlations
among capacity and certainty parameters, negative correlations involving
rework, small cross-category correlations — is consistent with the
expert judgment guidance in Vose (2008, *Risk Analysis: A Quantitative
Guide*) and with PMBOK Ch. 11 recommendations for quantitative risk
correlation modeling. The specific off-diagonal values are disclosed as
initial calibrations subject to empirical validation.

---

### III. STAGE 1 — BASELINE DISTRIBUTION GENERATION

From the three-point estimate, the system generates a discrete
probability density function (PDF) and cumulative distribution function
(CDF) representing the PERT baseline using Monte Carlo simulation with
smoothing.

**Process:**
1. Sample N = 100,000 values from Beta(α, β) fitted to (O, M, P)
2. Build histogram with adaptive bin width
3. Apply Gaussian kernel smoothing (σ_kernel = 0.5 × bin_width)
4. Normalize so that ∫PDF dx = 1.0
5. Compute CDF by trapezoidal integration of smoothed PDF

This baseline PDF/CDF is stored and used as the reference distribution
for KL divergence computation in Stage 5.

---

### III-A. STAGE 1 EXTENSION — BAYESIAN MCMC BASELINE WITH HISTORICAL CONTEXT

#### A. Motivation

Standard PERT Monte Carlo sampling produces an identical baseline
distribution regardless of whether the estimating organization has a
documented history of systematic overruns. An organization that
consistently delivers 20% over PERT predicted values should not receive
the same baseline probability as one with no overrun history. The SACO
system provides an optional Bayesian baseline update path that activates
when historical project data is available and gracefully falls back to
standard Monte Carlo when no history is supplied.

#### B. Historical Context Input

The system accepts an optional historical context parameter:

    priorHistory = {
      n:                integer ≥ 1   (number of similar past projects)
      meanOverrunFrac:  real ∈ (-0.5, 2.0)  (mean overrun as fraction:
                        0.15 = actuals averaged 15% above PERT predicted)
      stdOverrunFrac:   real ≥ 0, optional  (std dev of overrun across
                        the N projects; defaults to 0.5 × |mean|)
    }

"Similar project" is defined as one using the same unit of measure
(days, dollars, story points, etc.) and delivered by the same team or
under the same methodology. The overrun is expressed relative to the
PERT mean: if PERT predicted 100 days and actuals averaged 115, the
practitioner enters meanOverrunFrac = 0.15.

#### C. Student-t Prior with Metropolis-Hastings MCMC

The system models the organizational overrun rate μ_overrun as a latent
variable and samples its posterior distribution using Metropolis-Hastings
(MH) Markov Chain Monte Carlo. A Student-t prior with ν=4 degrees of
freedom is used in place of a Normal prior to achieve robustness against
outlier projects.

**Why Student-t, not Normal:**
A Normal prior on μ_overrun produces a closed-form conjugate posterior
but assigns exponentially diminishing probability to outlier observations.
If a single historical project overran by 200%, a Normal prior pulls the
posterior strongly toward that value. The Student-t(ν=4) prior has
heavier tails under which extreme observations are considered plausible
but not disproportionately influential. Gelman et al. ("Bayesian Data
Analysis," 3rd ed., §2.9) recommend ν=4 as the weakly-informative
default for location parameters; the posterior is no longer analytically
tractable, requiring MCMC.

**Prior:**

    μ_overrun ~ t(ν=4, location=0, scale=σ_prior)
    σ_prior   = 0.30   (spans ±30% overrun — calibrated against
                        Flyvbjerg et al. 2002 (infrastructure avg 45%)
                        and Jones 2007 (software avg 27%))

    log p(μ) ∝ -(ν+1)/2 · log(1 + μ²/(ν · σ²_prior))

**Likelihood (Normal, sufficient statistic):**

    data: N projects, sample mean = meanOverrunFrac, std = σ_obs

    log p(data|μ) ∝ -N · (μ − meanOverrunFrac)² / (2 · σ²_obs)

**Log-posterior (unnormalized):**

    log p(μ|data) = log p(data|μ) + log p(μ)

Because the Student-t prior and Normal likelihood are not conjugate,
the posterior has no closed form and is sampled via MH.

#### D. Metropolis-Hastings Algorithm with Burn-in and Thinning

The system runs a random-walk Metropolis-Hastings chain to draw samples
from p(μ_overrun | data):

**Chain parameters:**

    Total iterations : 5500
    Burn-in          : 500   (warm-up; discarded before collection)
    Thinning factor  : 5     (keep every 5th post-burn-in sample)
    Effective samples: (5500 − 500) / 5 = 1000

**Burn-in justification:** Early chain states depend on the
initialization point (μ_0 = meanOverrunFrac, the MLE). The first 500
iterations allow the chain to reach the high-probability region of the
posterior before samples are recorded. For a unimodal 1-dimensional
target with a well-tuned step size, 500 iterations is empirically
sufficient (Gelman et al., BDA3 §11.4).

**Thinning justification:** Successive chain states are correlated
(each is a small perturbation of the previous). Keeping every 5th
sample reduces this autocorrelation, producing a more independent
effective sample set for downstream use.

**Proposal distribution:**

    μ* = μ_current + ε,    ε ~ N(0, (0.5 · σ_prior)²)

Step size 0.5·σ_prior = 0.15 targets a MH acceptance rate of ~30–40%,
consistent with the optimal rate for 1-dimensional targets
(Roberts, Gelman & Gilks, 1997).

**Acceptance step:**

    log α = log p(μ*|data) − log p(μ_current|data)
    Accept μ* with probability min(1, exp(log α))

**Pseudocode:**

    μ_current ← meanOverrunFrac          // MLE warm start
    chainSamples ← []
    for i = 0 to 5499:
      μ* ← μ_current + N(0, 0.15²)
      log α ← logPost(μ*) − logPost(μ_current)
      u ← Uniform(0, 1)
      if log(u) < log α:
        μ_current ← μ*
      if i ≥ 500 and (i − 500) mod 5 == 0:
        chainSamples.append(μ_current)
    // |chainSamples| = 1000

**Credibility indicator:**

    credibility = min(1, N/10)

Surfaced in the UI (0–1) to communicate posterior signal strength.
Acceptance rate is also returned as a diagnostic (healthy range: 0.20–0.50).

#### E. Chain-Driven Overrun Injection

Rather than drawing overruns from a parametric approximation of the
posterior, the system uses the chain samples directly. For each PERT
base draw, a μ value is selected by cycling through the 1000 chain
samples. This correctly propagates epistemic uncertainty (which μ is
the true overrun rate?) without relying on a Gaussian approximation.
A separate aleatoric noise draw captures project-level variability
around the systematic rate:

    K ← |chainSamples|   (= 1000)
    x_max ← P × (1 + max(0, chainMean + 3·chainStd))

    For i = 1 to numSamples:
      s_i       = O + betaSample(α, β) × range      [PERT base draw]
      μ_k       = chainSamples[i mod K]             [epistemic: cycle chain]
      ε_i       = μ_k + σ_obs · N(0, 1)            [epistemic + aleatoric]
      adjusted_i = s_i × (1 + ε_i)                 [history-adjusted sample]
      clamped_i  = clamp(adjusted_i, O, x_max)

Where x_max extends the grid to accommodate positive-overrun tails
beyond the pessimistic estimate.

This produces a baseline distribution that is:
- Shifted rightward in proportion to chainMean (systematic overrun)
- Wider than the standard PERT baseline by chainStd + σ_obs (combined uncertainty)
- Robust to outlier historical projects via the Student-t prior
- Convergent with standard PERT baseline when N → 0 (graceful degradation)

The same Gaussian KDE (bandwidth h = gridRange/63.3) and trapezoid
normalization from Stage 1 are applied to the adjusted samples.

#### F. Mode Switching

The system automatically selects between the two baseline generation
modes at runtime:

    if (priorHistory && N ≥ 1 && isFinite(meanOverrunFrac)):
      baseline = generateMCMCSmoothedPoints(params)   // MH-MCMC path
    else:
      baseline = generateMonteCarloSmoothedPoints(params)  // standard path

All downstream stages (Gaussian copula, betaRefit, optimizer, KL
divergence) operate identically on the resulting PDF/CDF regardless of
which mode generated it. The MH-MCMC extension is fully contained within
Stage 1; no changes to Stages 2–7 are required.

---

### IV. STAGE 2 — LATIN HYPERCUBE SAMPLING (Global Exploration)

The system generates N quasi-random sample points in [0,1]⁷ using
Latin Hypercube Sampling (LHS), which ensures uniform coverage of the
7-dimensional parameter space without clustering.

**Sample count formula:**

    Non-adaptive mode:  n = 250  (fixed, independent of probeLevel)
    Adaptive mode:      n = max(100, 50 × probeLevel)

At probeLevel=1 in adaptive mode, the system uses a degenerate
single-point evaluation: instead of generating LHS samples, it uses
the seed point (from the preceding fixed pass) directly and skips
further grid evaluation at that probe depth. This prevents the
adaptive pass from redundantly re-exploring the same global space
the fixed pass already covered.

**BENCH array — Per-Dimension LHS Upper Bound Caps:**

The LHS search space is not [0,1]⁷ but a reduced hypercube bounded by:

    BENCH = [75, 75, 60, 50, 25, 50, 50]

    (for: BUD, SCH, SC, SRA, RWK, RISK, CONF — values in percent)

For each dimension d, the effective LHS upper bound is:

    hi_d = min(PER_SLIDER_BOUNDS[d].hi, BENCH[d] / 100)

**Motivation for BENCH caps:** The BENCH values represent
operationally realistic upper bounds on each management lever. Allowing
LHS to sample at 100% budget flexibility, 100% scope certainty, or 100%
risk tolerance would cause the optimizer to explore configurations that
are numerically feasible but operationally implausible — no real project
operates at the absolute maximum of all management stance dimensions
simultaneously. The BENCH array caps exploration at calibrated upper
limits that represent "very high but realistic" lever settings, keeping
the optimizer's search within the operationally meaningful subspace.

**Per-dimension BENCH rationale:**
- BUD (75): Maximum credible budget contingency reserve is ~75%
- SCH (75): Maximum schedule flexibility before a project becomes open-ended
- SC (60): Perfect scope certainty is rare; 60% represents well-defined scope
- SRA (50): Scope reduction allowance above 50% implies half the work is optional
- RWK (25): Rework above 25% indicates process breakdown; hard cap at 0.50
  domain (in optimizer's COBYLA box function, rework is additionally hard-capped
  at 0.50 in [0,1] space = 25% UI domain to prevent degenerate rework scenarios)
- RISK (50): Risk tolerance above 50% characterizes high-risk organizations
- CONF (50): User confidence above 50 is already self-reported high; 100 is
  treated as overconfident based on calibration literature (Hubbard 2007)

**Bias adjustment in adaptive mode:**
In adaptive mode, after LHS generation, the system applies a bias offset
to each sample:

    bias = (CV > 0.5 OR p₀ < 0.3) ? 0.15 : 0
    bias += 0.2 × sign(skew) × min(0.3, 1 − p₀)

    sample[d] ← clamp(lo + scale × sample[d] + bias × scale, 0, 1)

This biases sampling toward higher slider values when the distribution
has high uncertainty (CV > 0.5) or when the baseline probability is
already low (p₀ < 0.3), focusing exploration where improvement is
most needed.

**LHS Algorithm:**
For each dimension d ∈ {1,...,7}:
1. Divide [0,1] into n equal intervals
2. Randomly sample once from each interval
3. Randomly permute the n samples across dimensions
4. Result: n points each covering every stratum exactly once

This guarantees no two sample points share the same interval in any
dimension, providing better coverage than pure random sampling for
optimization warm starts.

---

### V. STAGE 3–4 — GRID SEARCH AND WARM START

For each of the n LHS sample points **s** = (s₁,...,s₇), the system
evaluates the SACO objective function (described in Section VIII) and
retains the highest-scoring point as the warm start for local refinement.

The grid search identifies the global basin of attraction without
committing computational resources to local gradient descent from
a potentially poor starting point.

**Warm-start trial configuration (Stage 3):**
Stage 3 does not evaluate raw LHS points directly. Instead, it takes
the first 50 points from the LHS sample set and constructs modified
trial vectors by overriding sliders 4–7 with fixed initialization values:

    For each s = (s₀, s₁, s₂, s₃, s₄, s₅, s₆) from LHS (first 50):
        trial = (s₀, s₁, s₂, 0.50, 0.25, 0.50, 0.50)

That is: budget, schedule, and scope dimensions vary per LHS sample,
while scope reduction (0.50), rework (0.25), risk tolerance (0.50),
and user confidence (0.50) are initialized at their midpoint values.

**Motivation:** Sliders 4–7 have either domain caps (rework ≤ 0.50) or
relatively lower information weight (user confidence). Initializing
them at midpoints reduces the search noise from these dimensions during
warm start, while allowing the three highest-leverage dimensions (budget,
schedule, scope) to vary freely per the LHS stratification. Stage 4
subsequently relaxes all seven dimensions in the full LHS search.

**Default fallback sliders (pmDefaults):**
When the full grid search (Stage 4) fails to find any configuration
that improves on the baseline probability, the system promotes a
default configuration as a safe fallback rather than returning
degenerate zeros:

    pmDefaults = [0.65, 0.65, 0.60, 0.15, 0.25, 0.50, 0.50]

    (for: BUD, SCH, SC, SRA, RWK, RISK, CONF — in [0,1] space)

These values represent a conservatively favorable management stance:
budget and schedule flexibility at 65%, scope certainty at 60%,
scope reduction allowance low (15%), rework at the moderate midpoint
(25%), and risk tolerance and confidence at neutral midpoint (50%).
pmDefaults also serves as the final-output fallback when an unhandled
error prevents any optimization from completing.

---

### VI. STAGE 5 — COBYLA LOCAL REFINEMENT

Starting from the warm-start point identified in Stage 4, the system
applies the COBYLA (Constrained Optimization BY Linear Approximation)
algorithm to find the local optimum of the SACO objective function.

COBYLA is a gradient-free method suitable for:
- Non-smooth objective functions
- Black-box function evaluations
- Bound-constrained optimization without derivative computation

**COBYLA-lite parameters:**
- Initial trust region radius: ρ_init = 0.5
- Final trust region radius: ρ_final = 1×10⁻⁵
- Maximum iterations: 80 (fixed/non-adaptive) or 5–80 (adaptive, scaled by probeLevel)
- Bounds: sᵢ ∈ [lo_i, hi_i] per slider (from PER_SLIDER_BOUNDS, Table 1)

**Skew-Adaptive Step Size:**
For each candidate dimension k, the exploration step size incorporates
the distribution's skewness to bias exploration toward the natural
tail of the PERT distribution:

    δₖ = ρ / (|W_MEAN[k]| + 0.05) × (1 + 0.1 × sign(W_MEAN[k]) × skew_proxy)

where skew_proxy = (μ_base − τ) / σ_baseline. This formula makes
steps larger for dimensions with small |W_MEAN| (less leverage) and
biases step direction toward the heavier tail of the distribution:
if τ < μ (target below mean, distribution right-heavy), the skew proxy
is positive and steps for favorable sliders (sign(W_MEAN[k]) > 0) are
amplified, focusing exploration where improvement is most likely.

**Shrinkage rates:**
- When no improvement is found: ρ ← ρ × 0.5
- Otherwise (non-adaptive or probeLevel ≤ 2): ρ ← ρ × 0.6
- Otherwise (adaptive and probeLevel > 2): ρ ← ρ × 0.7
  (slower shrinkage at higher probe levels to prevent premature convergence)

**Every-10-iteration seed anchor (adaptive mode):**
In adaptive mode, every 10 iterations the system checks whether the
current best solution has drifted more than 8% relative deviation from
the Not Benchmarked seed:

    max_div = max_i( |x_i − seed_i| / max(seed_i, 0.01) )

    if max_div > 0.08:
        x_i ← lerp(x_i, seed_i, 0.8)   for all i  [80% pull toward seed]

This prevents the adaptive optimizer from gradually drifting to
configurations far from the practitioner's intent even if the objective
function supports such drift. The 8% relative threshold and 80% pull
strength are calibrated to allow meaningful exploration while preventing
large-scale seed abandonment.

---

### VI-B. TWO-PASS OPTIMIZATION ARCHITECTURE

The SACO optimizer executes two complete optimization passes —
a **fixed pass** followed by an **adaptive pass** — rather than a
single optimization run. This two-pass design is a distinct architectural
element with multiple independent motivations.

**Fixed Pass (Pass 1):**

    Parameters: adaptive = false, probeLevel = 1

The fixed pass uses a minimal LHS exploration (probeLevel=1 degenerate
mode: single seed point) and a short COBYLA refinement
(maxIter=5, rhoInit=0.15, rhoFinal=0.15 — effectively a 5-step
local search from the warm start). It operates without a leash
penalty (no seedBest available yet) and without ambition detection
(adaptive=false disables the bb formula; bb is passed as the static
bBias parameter). The fixed pass produces a coarse but unbiased
estimate of the optimizer's preferred slider configuration.

**Adaptive Pass (Pass 2):**

    Parameters: adaptive = true, probeLevel = user-specified (1–7)

The adaptive pass uses the fixed pass result as its seed:

    seedBest = fixed_pass_result.x   (7-dimensional slider vector)

It then runs full LHS sampling (n = max(100, 50×probeLevel)),
full COBYLA refinement (maxIter=100, skew-adaptive step sizes),
and engages the leash penalty (using seedBest as the anchor), the
bb formula, ambition detection, and the every-10-iteration seed
anchor. The adaptive pass is constrained to stay near the fixed pass
result via the leash penalty and anchor pull.

**Why two passes:**

1. **Cold-start problem:** COBYLA is a local optimizer. Without a
   good starting point, it may converge to a poor local optimum.
   The fixed pass provides a coarse but globally-informed seed to
   the adaptive pass at negligible extra cost.

2. **Leash requires a seed:** The difficulty-adaptive leash penalty
   (Section X) penalizes deviation from seedBest. In a single pass,
   there is no seed. The two-pass design makes the leash meaningful:
   the adaptive pass is constrained relative to the fixed pass's
   answer, not a hypothetical prior.

3. **Reproducibility:** The fixed pass result is deterministic given
   O, M, P, τ (no randomness in probeLevel=1 degenerate mode). This
   provides a stable seed anchor even when the adaptive pass uses
   random LHS samples. The two-pass structure produces more consistent
   results across repeated runs than a single high-probe-level pass.

4. **Taming factor interaction:** The taming factor (Section X-B)
   creates a mild preference for lower-probe-level solutions. The
   two-pass architecture naturally produces a fixed-pass result at
   effective probeLevel=1 and an adaptive-pass result at the user's
   chosen depth. If the adaptive pass finds no improvement over the
   fixed pass (modulo taming), the system returns the fixed pass
   result — a conservative, parsimonious solution.

**Disclosure:** The two-pass workflow is an independently novel
system architecture element. The combination of: (a) a fixed-pass
seed generator, (b) a leash anchored to the fixed pass result,
and (c) an adaptive pass whose exploration is tethered to a
reproducible coarse solution is, to the inventor's knowledge,
without direct precedent in published probabilistic estimation
or COBYLA-based optimization literature.

---

### VII. GAUSSIAN COPULA DEPENDENCY MODELING

#### A. Motivation

Standard aggregation of the seven slider parameters assumes
independence — that budget flexibility does not correlate with schedule
flexibility, that scope certainty does not correlate with rework
percentage, etc. This assumption is false in practice.

SACO models realistic dependencies between the seven project
characteristic parameters using a Gaussian copula with a theoretically
derived correlation matrix.

**Novel application of copula theory:** Copulas are conventionally applied
to model statistical dependencies between *uncertain random variables*
(chance nodes). SACO applies the Gaussian copula to model organizational
dependencies between *management policy decisions* (decision nodes) —
recognizing that budget flexibility and schedule flexibility are
organizationally correlated commitments, not independent choices. This is,
to the inventors' knowledge, the first application of copula theory to
the joint dependency structure of a decision node vector rather than a
chance node vector in a project estimation context.

#### B. The Base Correlation Matrix (BASE_R)

The system uses the following 7×7 symmetric positive-definite correlation
matrix derived from project management theory (PMBOK guidance on
knowledge area interdependencies):

              BUD    SCH    SC     SRA    RWK    RISK   CONF
    BUD  [ 1.00,  0.40,  0.10,  0.05,  0.00, -0.05,  0.05 ]
    SCH  [ 0.40,  1.00,  0.10,  0.05,  0.00, -0.05,  0.05 ]
    SC   [ 0.10,  0.10,  1.00,  0.35, -0.10,  0.00,  0.00 ]
    SRA  [ 0.05,  0.05,  0.35,  1.00, -0.05,  0.00,  0.00 ]
    RWK  [ 0.00,  0.00, -0.10, -0.05,  1.00, -0.10, -0.10 ]
    RISK [-0.05, -0.05,  0.00,  0.00, -0.10,  1.00,  0.25 ]
    CONF [ 0.05,  0.05,  0.00,  0.00, -0.10,  0.25,  1.00 ]

**Key correlations and their theoretical basis:**

- BUD ↔ SCH = +0.40: Budget and schedule are positively correlated
  (cost-time trade-off; PMBOK Integration Management)

- SC ↔ SRA = +0.35: Clear scope implies more negotiable scope
  (well-defined work packages enable scope decomposition)

- SC ↔ RWK = -0.10: Certain scope implies less rework
  (ambiguous requirements drive iteration cycles)

- RISK ↔ CONF = +0.25: Higher risk tolerance correlates with
  practitioner confidence (experienced practitioners accept uncertainty)

- BUD ↔ RISK = -0.05: Budget-constrained projects have lower risk
  tolerance (financial pressure reduces risk appetite)

#### C. Copula Transformation Algorithm

Given the normalized slider vector **S₀₁** = (s₁,...,s₇) ∈ [0,1]⁷:

**Step 1: Invert negative-direction variables**
Rework is a negative factor (higher = worse). Before applying the
copula, rework is inverted to express all variables in "goodness" space:

    S₀₁[RWK] ← 1 - S₀₁[RWK]

**Step 2: Transform to z-scores**

    z̄ = mean(S₀₁)
    z_std = std(S₀₁)
    zᵢ = (S₀₁[i] - z̄) / max(z_std, ε)   for each i

**Step 3: Apply correlation matrix**

    z_corr[i] = Σⱼ BASE_R[i][j] × z[j]   for each i

**Step 4: Transform back to [0,1] via sigmoid**

    Uᵢ = clamp(0.5 + 0.2 × tanh(z_corr[i]), 0, 1)

**Step 5: Compute copula coupling coefficient**

    coupling = mean(U₁,...,U₇)

The coupling coefficient represents the joint "pressure" of all seven
project characteristics simultaneously. It ranges from 0 (all sliders
at their worst) to 1 (all sliders at their best) and is used to
determine the interpolation weight in the hybrid moment mapping.

---

### VII-D. PSD STABILIZATION AND CHOLESKY DECOMPOSITION

Before applying the BASE_R correlation matrix in any computation
requiring positive semi-definiteness — including Cholesky decomposition
for correlated sample generation during Monte Carlo sensitivity analysis
— the system applies a small diagonal jitter to guarantee numerical
stability:

    BASE_R_stable[i][i] = min(1.0, BASE_R[i][i] + 1×10⁻³)

**Motivation:** Floating-point arithmetic can produce slightly negative
minimum eigenvalues in a theoretically PSD matrix. The 1×10⁻³ jitter
shifts all eigenvalues upward by at least 1×10⁻³, ensuring the matrix
is numerically PSD while introducing negligible distortion to the
correlation structure (the maximum relative change to any off-diagonal
entry is less than 0.1% at the magnitudes used in BASE_R).

**Cholesky decomposition for correlated sampling:**
When the copula is used to generate correlated samples (e.g., during
stochastic simulation, sensitivity bootstrapping, and cross-task
correlation modeling), BASE_R_stable is Cholesky-factored:

    L = chol(BASE_R_stable),  with internal ε = 1×10⁻⁹ safety shift

    such that  L × Lᵀ ≈ BASE_R_stable

Correlated z-score vectors are then generated as:

    z_corr = L × z_iid,    where z_iid ~ N(0, I₇)

This ensures the joint distribution of (z_corr₁,...,z_corr₇)
reproduces the covariance structure specified by BASE_R_stable exactly
(within floating-point precision), which is the defining property of
a Gaussian copula.

**Three-level stabilization:** The system applies PSD stabilization at
three independent levels with distinct eps values at each level:

1. **Coupling signal jitter (eps = 1×10⁻⁶):** When computing the copula
   coupling signal `computeCouplingSignal(S₀₁)` — the scalar that drives
   the blend weight t = clamp(0.3 + 0.4 × coupling) — a minimal jitter of
   1×10⁻⁶ is applied to BASE_R before the z-score → R·z computation.
   This prevents numerical instability in the z-score standardization step
   without materially altering the correlation structure used in coupling.

2. **Cholesky pre-jitter (eps = 1×10⁻³):** Before any Cholesky
   factorization of BASE_R for correlated sample generation (used in
   sensitivity bootstrapping and cross-task correlation modeling), a larger
   1×10⁻³ diagonal jitter is applied. The larger value ensures proper
   PSD status even when the Tightly Coupled preset scales all off-diagonal
   entries by 1.5, which reduces the smallest eigenvalue substantially.

3. **Cholesky algorithm internal shift (eps = 1×10⁻⁹):** Inside the
   Cholesky algorithm itself, diagonal remainders are floored:
   `L[i][i] = sqrt(max(sum, 1e-9))`, preventing sqrt of a negative number
   from edge-case numerical errors in the Gram sum.

The three eps values are calibrated for their specific computational
contexts: coupling (1×10⁻⁶, minimal) → Cholesky pre-jitter (1×10⁻³,
moderate, covers Tightly Coupled preset) → Cholesky floor (1×10⁻⁹,
fallback guard). Using a single eps value for all three would either
over-distort the correlation structure (if set to 1×10⁻³ for the coupling
signal) or insufficiently stabilize Cholesky (if set to 1×10⁻⁶ for
Tightly Coupled preset).

**Why not just use eigenvalue decomposition:** While eigenvalue
decomposition is also a valid PSD repair method, Cholesky factorization
is O(n³/3) versus O(n³) for full eigendecomposition, is numerically
more stable for nearly-PSD matrices, and preserves the triangular
structure needed for efficient correlated sampling. For n=7 (the SACO
management stance dimension), the computational difference is trivial,
but the Cholesky approach is architecturally consistent with the
inter-task correlation extensions described in the CP Engine disclosure.

---

### VIII. HYBRID MOMENT MAPPING

This is the core innovation of SACO: computing adjusted distribution
moments (m₀ for mean adjustment, m₁ for variance adjustment) from the
copula-transformed slider values.

#### A. Linear Aggregation (Conservative Estimate)

    W = [0.20, 0.20, 0.18, 0.15, 0.10, 0.09, 0.08]
    lin = Σᵢ Wᵢ × S₀₁[i]

This represents a conservative, weighted-sum aggregation of project
goodness. It treats the overall project favorability as proportional
to the weighted sum of individual characteristic quality.

#### B. Probabilistic Disjunction (Murphy's Law Formulation)

    por = 1 - ∏ᵢ (1 - 0.9 × S₀₁[i])

This represents the "probabilistic OR" interpretation: the probability
that at least one project uncertainty factor will manifest. As any single
slider increases toward 1 (high uncertainty), por approaches 1 (near
certainty that something will go wrong). This captures the well-known
project management phenomenon that projects rarely fail for a single
reason — multiple small risks combine.

#### C. Copula-Aware Hybrid Interpolation (Novel Combination)

The interpolation between the conservative linear estimate and the
pessimistic probabilistic-OR estimate is itself a function of the
copula coupling coefficient:

    t = clamp(0.3 + 0.4 × coupling, 0, 1)
    m₀ = (1 - t) × lin + t × por

**Properties of this formula:**
- When coupling is low (sliders uncorrelated, diverse risk profile):
  t → 0.3 (weighted 70% conservative, 30% pessimistic)
- When coupling is high (sliders highly correlated, systemic risk):
  t → 0.7 (weighted 30% conservative, 70% pessimistic)
- The copula coupling naturally amplifies systemic risk — when budget,
  schedule, and scope issues all appear together (high correlation),
  the system appropriately weights the pessimistic scenario more heavily.

This is fundamentally different from either pure linear regression or
pure probabilistic aggregation. The interpolation weight is not a
fixed hyperparameter but an emergent property of the dependency
structure of the input parameters.

#### D. Variance Adjustment (Inverse Relationship)

    m₁_copula = (0.8 − 0.5 × lin) × (1 + CV/2)

**Critical design choice — inverse relationship:**
As lin increases (higher overall slider goodness), the variance
multiplier *decreases*. This is counterintuitive but principled:
practitioners who provide wide P-O ranges (high variance estimates)
are already accounting for uncertainty. If SACO also amplifies variance
for high-uncertainty sliders, it creates an "uncertainty spiral" where
variance explodes unrealistically. The inverse relationship prevents
double-penalization of uncertain estimates.

---

#### E. Thesis Moment Path (W_MEAN / DIAG_W Architecture)

In parallel with the copula path (Sections VIII.A–D), the system
computes a second moment estimate via a "thesis path" using separately
calibrated weight matrices:

**Signed Moment Weights:**

    W_MEAN = [−0.20, +0.10, +0.30, −0.15, −0.08, +0.25, +0.05]

    (for: BUD, SCH, SC, SRA, RWK, RISK, CONF)

Sign convention: negative weights indicate that a higher slider value
*reduces* the expected duration (favorable lever); positive weights
indicate a lever that, when high, *increases* duration or uncertainty.
This is separate from the PMBOK blend weights W used in the copula path.

**Diagonal Scaling Weights:**

    DIAG_W = [0.20, 0.20, 0.15, 0.15, 0.10, 0.25, 0.10]

DIAG_W scales each slider's contribution to reflect its independent
magnitude relative to the project's benchmark range. These values
represent the maximum fractional influence each lever can exert on
the thesis moment before scaling.

**Variance Thesis Weights:**

    W_VAR = [0.10, 0.10, 0.20, 0.15, 0.08, 0.50, 0.05]

W_VAR weights each lever's contribution to the variance adjustment
in the thesis path. Risk Tolerance (index 5) carries the highest W_VAR
weight (0.50), reflecting that stated risk appetite is the primary
driver of distribution width in the thesis formulation.

**Thesis Moment Computation:**

    m₀_thesis = Σᵢ S₀₁[i] × W_MEAN[i] × DIAG_W[i] × scaleFactor
    m₁_thesis = Σᵢ S₀₁[i] × W_VAR[i] × DIAG_W[i] × scaleFactor × (1 + CV/2)

    m₀_thesis = clamp(m₀_thesis, −0.8, 0.8)
    m₁_thesis = clamp(m₁_thesis, 0, 1.5)

where scaleFactor = 1 (fixed at this value in the current implementation;
the architecture permits non-unity values for future calibration).

**Note on rework inversion in the copula path vs. thesis path:** In the
copula path (Sections VIII.A–C), rework S₅ is inverted before copula
processing (`S₀₁[RWK] ← 1 − S₀₁[RWK]`). In the thesis path, S₀₁
values are used post-inversion (same normalized values). W_MEAN[4]
= −0.08 (negative): higher post-inversion rework value corresponds to
*lower* raw rework, which *reduces* expected duration. This is consistent
with the copula path's sign convention.

---

#### F. 50/50 Hybrid Blend (Final Moments)

The final moments output by `computeAdjustedMoments` blends the copula
path and the thesis path with equal weighting:

    hybrid_m₀ = 0.5 × m₀_copula + 0.5 × m₀_thesis
    hybrid_m₁ = 0.5 × m₁_copula + 0.5 × m₁_thesis

**Motivation for equal weighting:**
- The copula path (Section VIII.A–D) is grounded in information-theoretic
  first principles: it uses the probabilistic disjunction (Murphy's Law)
  and linear aggregation as two extreme models, interpolated by the
  data-driven coupling coefficient. It is theoretically motivated but
  less responsive to individual slider directionality.
- The thesis path (Section VIII.E) is empirically calibrated: it uses
  signed, directional weights (W_MEAN) to capture the asymmetric effect
  of favorable versus unfavorable levers, plus DIAG_W scaling from
  PMBOK benchmark data. It is more responsive to individual lever
  direction but less grounded in information theory.
- Equal weighting produces a result that inherits both paths' strengths:
  the copula path prevents extreme optimization in pathological slider
  combinations; the thesis path ensures that the signed directionality
  of each lever (budget flexibility *reduces* duration, rework *increases*
  it) is correctly reflected in the moment adjustment.

**Disclosure:** The 50/50 hybrid blend is an empirically calibrated
design decision. Future versions may introduce a data-driven blend weight
derived from reference class validation. The hybrid architecture (copula
path + thesis path with explicit blend weight) is disclosed as a novel
system claim.

---

### IX. BETA DISTRIBUTION REFIT (Moment Matching)

Given the adjusted moments (m₀, m₁), the system refits a Beta
distribution using method-of-moments estimation:

**Step 1: Compute adjusted PERT moments in absolute units**

    μ₀ = (O + 4M + P) / 6          [baseline PERT mean]
    σ²₀ = ((P - O) / 6)²           [baseline PERT variance]

    μ₁ = μ₀ × (1 - clamp(m₀, 0, 1) × 0.2)     [shift by m₀]
    σ²₁ = max(σ²₀ × (1 - clamp(m₁, 0, 1) × 0.5), ε)  [scale by m₁]

**Step 2: Normalize to [0,1] space for Beta parameterization**

    range = P - O
    μ₀₁ = clamp((μ₁ - O) / range, ε, 1-ε)
    σ²₀₁ = max(σ²₁ / range², ε)

**Step 3: Solve for Beta parameters via method of moments**

    κ = μ₀₁ × (1 - μ₀₁) / σ²₀₁ - 1
    α' = μ₀₁ × κ
    β' = (1 - μ₀₁) × κ

**Step 4: Generate reshaped distribution**

The system samples N points from Beta(α', β') scaled back to [O, P]
and applies the same smoothing procedure as Stage 1, producing the
reshaped PDF and CDF.

---

### X. THE SACO OBJECTIVE FUNCTION

The function maximized during optimization combines three terms:

    score = P(τ)^(1+bb) × exp(-KL) × exp(-leash_penalty)

Where:

**P(τ):** The probability of completion at or before the target value τ
under the reshaped distribution. This is the primary optimization target.

**(1+bb):** A bias exponent bb ∈ [0, 0.05] that amplifies the
probability term, giving larger credit to improvements in high-uncertainty
scenarios. In adaptive optimization mode, bb is computed as:

    bb = 0.05 + 0.03 × mean(W_MEAN[i] × S₀₁[i] × sign(W_MEAN[i]))
         for i ∈ {0, ..., 6}

where W_MEAN = [−0.20, +0.10, +0.30, −0.15, −0.08, +0.25, +0.05]
and S₀₁[i] are the normalized [0,1] slider values.

**Interpretation:** For each slider i, W_MEAN[i] × S₀₁[i] × sign(W_MEAN[i])
= |W_MEAN[i]| × S₀₁[i] — always a non-negative contribution. The mean
of these seven non-negative products gives the average "weighted slider
activity." Adding 0.05 and scaling by 0.03 produces a bb that rises
from ≈0.05 (all sliders at zero) to a maximum of ≈0.05 + 0.03 × max_mean.
In practice, with typical slider ranges, bb ∈ [0.05, ~0.08], but the
clamp to the range [0, 0.05] in Claim 21 caps the disclosed range.

**Relationship to Risk Tolerance (S₆):** W_MEAN[5] (Risk Tolerance) = +0.25,
the second-highest absolute W_MEAN value, so Risk Tolerance has
substantial influence on bb, but all seven sliders contribute to it
via the mean formula. Risk Tolerance's dominant mechanistic role remains
correct: it is the only slider that does not appear in the OMP adjustment
formulas (Section XI), making bb its exclusive mechanical outlet. The
other six sliders each participate in both OMP adjustment AND bb,
while Risk Tolerance participates only in bb.

See Ambition Detection (Section X-A) for the condition under which
bb is automatically forced to zero regardless of slider values.

**exp(-KL):** The KL divergence safety penalty. KL is the
Kullback-Leibler divergence between the reshaped distribution Q and
the baseline distribution P:

    KL(P || Q) = ∫ P(x) × log(P(x)/Q(x)) dx

Computed by trapezoidal numerical integration. The exponential penalty
exp(-KL) approaches 1 when Q ≈ P (minimal reshaping) and approaches 0
when Q is very different from P (extreme reshaping). This term prevents
the optimizer from finding slider combinations that produce unrealistic
distributions by constraining maximum divergence to approximately 5%.

**exp(-leash_penalty):** A difficulty-adaptive penalty preventing the
optimizer from recommending slider values that deviate excessively from
the user's manually set values. The leash uses an exponential per-slider
form tied to the baseline probability:

    λ_leash = 0.05 × (1 − p₀)

    For each slider i:
        dev_i = |S*ᵢ − seed_i| / max(seed_i, 0.01)   [relative deviation]

    raw_leash = Σᵢ λ_leash × exp(dev_i / 0.1)
    leash_penalty = max(0, raw_leash − 1)              [threshold subtraction]

where S*ᵢ are the current optimizer slider candidates and seed_i are the
slider values found by the initial (non-adaptive) optimization pass.

**Two design choices distinguish this from a simple penalty:**

1. **Relative deviation:** The deviation is normalized by seed_i (the
   seed slider value), not absolute. A deviation of 0.05 from a seed of
   0.50 (10% relative) and a deviation of 0.05 from a seed of 0.10 (50%
   relative) receive different penalty contributions. This makes the leash
   proportionally sensitive: large sliders can tolerate larger absolute
   deviations; small sliders are constrained tightly.

2. **Threshold subtraction of 1.0:** The raw accumulated penalty has 1.0
   subtracted before clamping to zero. This provides a "free zone" of
   cumulative penalty up to 1.0 — modest deviations across all seven sliders
   collectively accumulate up to 1.0 without incurring any penalty at all.
   Only when the total raw penalty exceeds 1.0 does the leash engage. This
   prevents the leash from penalizing every slight deviation and allows the
   optimizer legitimate exploratory freedom near the seed.

**Properties of the relative exponential leash:**
- λ_leash scales inversely with p₀: hard scenarios (low p₀) → λ up to
  0.05; easy scenarios (p₀ near 1) → λ near 0.
- exp(dev_i / 0.1): relative deviation of 0.10 (10% relative) yields e¹ ≈
  2.72× per-slider term; 0.20 relative yields e² ≈ 7.4× — the exponential
  makes large relative deviations rapidly costly.
- The free threshold of 1.0 total penalty means approximately 7 sliders
  each at a relative deviation of ≈0.10 would be needed to trigger any
  penalty at all under λ_leash = 0.05 (hard scenario).
- This anchors the Benchmarked optimization near the Not Benchmarked seed
  with tightness calibrated to both estimation difficulty and slider scale.

**Feasibility constraint:** Any slider configuration that violates the
monotone ordering of the adjusted three-point estimate (see Section XI
for the complete erf-based slack formulation) receives a score of −10¹²,
effectively eliminating it from consideration.

---

### X-A. AMBITION DETECTION (Automatic bb Override)

The system detects "ambitious" estimation scenarios in which the
target value τ already carries majority probability under the PERT
baseline, and the target lies above the PERT mean:

    Ambition condition:  τ > μ_base  AND  p₀ > 0.50

    If condition is true:  bb ← 0  (disable probability amplification)

**Motivation:** When a target is above the distribution mean and already
has majority probability under the baseline, applying the bias exponent
(1+bb) amplifies a term that is favorable by construction — artificially
inflating scores for configurations that require no genuine optimization
effort. Worse, it creates an asymmetry: hard scenarios (target below
mean, p₀ < 50%) receive bb > 0 amplification while easy scenarios
(already winning) also receive amplification, making the two sets of
scores incomparable.

Setting bb = 0 when the ambition condition is met converts the objective
to pure probability maximization in easy scenarios, ensuring score
comparability: a hard target at 40% baseline and an easy target at 60%
baseline are measured by P(τ) alone in their respective optimization
runs.

**Disclosure:** Ambition detection is a branching condition in the
objective function with no prior art equivalent in project estimation
literature. It is the first formal treatment of the "easy scenario
over-reward" problem in constrained probability optimization.

---

### X-B. TAMING FACTOR (Probe-Level-Dependent Objective Scaling)

The system applies a probe-level-dependent scaling factor to the
final optimization score:

    taming_factor = 1 + 0.01 / (probeLevel + 1)
    score_final = score × taming_factor

Where probeLevel ∈ {0, 1, 2, 3, 4, 5, 6, 7} controls the depth of
the LHS global search and COBYLA local refinement.

**Numerical values:**
- probeLevel = 0: taming_factor = 1.0100 (+1.00%)
- probeLevel = 1: taming_factor = 1.0050 (+0.50%)
- probeLevel = 3: taming_factor = 1.0025 (+0.25%)
- probeLevel = 7: taming_factor = 1.00125 (+0.125%)

**Motivation:** At higher probe levels, the optimizer explores a
larger region of the parameter space with more LHS samples and
COBYLA iterations. This increases the probability of finding extreme
configurations that score well by exploiting the edges of the
optimization landscape — configurations that are mathematically
optimal under the objective function but represent operationally
unrealistic combinations of slider values. The taming factor
provides a small, monotonically decreasing bonus as probe level
increases. This creates a mild preference for solutions found at
lower probe levels when scores are otherwise equivalent, improving
result consistency and reproducibility across the probe level scale.

The effect is intentionally small (< 1%) and does not materially
alter which configuration is selected as optimal. Its primary purpose
is to break near-ties in favor of shallower-search solutions, which
tend to be more parsimonious (closer to the warm-start seed) and
therefore more operationally plausible.

---

### XI. SLIDER-ADJUSTED THREE-POINT ESTIMATE

The SACO pipeline uses **two distinct OMP transformation formulas** in
two separate roles. Both operate on slider values normalized to [0,1].

#### A. Objective Function Transform (Beta Refit Input)

Used in the objective function (Stage 5) to compute the actual
reshaped distribution bounds fed to the Beta distribution refit:

    O' = O × (1 − S₁ × 0.25) × (1 − S₄ × 0.12)
    M' = M × (1 − S₂ × 0.12) × (1 − S₇ × 0.08) × (1 + S₅ × 0.10)
    P' = P × (1 − S₃ × 0.20) × (1 − S₄ × 0.10) × (1 + S₅ × 0.08)

    Monotone safety clamp:
    O'_safe = O'
    M'_safe = max(O'_safe × 1.001, M')
    P'_safe = max(M'_safe × 1.001, P')

**Interpretation of adjustment signs (objective transform):**
- S₁ Budget Flexibility: reduces O' (favorable budget tightens optimistic)
- S₂ Schedule Flexibility: reduces M' (flexible schedule → tighter most-likely)
- S₃ Scope Certainty: reduces P' (defined scope compresses pessimistic)
- S₄ Scope Reduction: reduces both O' and P'
- S₅ Rework: increases M' and P' (rework widens duration bands)
- S₆ Risk Tolerance: does NOT appear in this formula — affects bb only
- S₇ User Confidence: reduces M' (high confidence tightens most-likely)

#### B. Feasibility Check Transform (Monotone Ordering Stress Test)

A second, separate formula is used exclusively in the monotone
feasibility check. It computes worst-case boundary expansions to
verify that even under extreme slider combinations the ordering
adjO_feas < adjM_feas × slack AND adjM_feas < adjP_feas × slack holds:

    adjO_feas = O × (1 − S₁ × 0.20) × (1 − S₄ × 0.15)
    adjM_feas = M × (1 + S₂ × 0.10 − S₅ × 0.08) × (1 + S₇ × 0.05)
    adjP_feas = P × (1 + S₃ × 0.30) × (1 + S₆ × 0.25)

**Design rationale for the sign difference:**
In the feasibility transform, scope certainty (S₃) and risk tolerance (S₆)
*expand* P (positive coefficient), because the feasibility check performs
a boundary stress test: "what is the largest P could become?" rather than
"how does P shrink when scope is clear?" The objective function uses the
favorable-direction sign (scope certainty *reduces* P to tighten the
worst case), while the feasibility function uses the expansion-direction
sign (scope certainty *increases* P to stress-test the ordering boundary).

**Table 1 correspondence:** The coefficients in the feasibility transform
(S₁→0.20, S₄→0.15 for adjO; S₃→0.30, S₆→0.25 for adjP) match the
"Feasibility Coefficient" column in Table 1 of this application.

**Monotone Feasibility with erf-Based Distribution-Adaptive Slack:**

After computing adjusted O', M', P', the system enforces strict
monotonic ordering using a context-sensitive slack factor:

    μ_base = (O + 4M + P) / 6               [PERT mean]
    σ_base = (P − O) / 6                    [PERT std approximation]
    CV     = σ_base / μ_base                 [coefficient of variation]
    skew   = (μ_base − M) / σ_base          [skewness proxy]
    p₀     = P_baseline(τ)                  [baseline probability]

    slack  = 1 + 0.05 × CV × (1 − p₀/0.5) × erf(|skew| / √2)

    Feasibility conditions:
        adjO < adjM × slack
        adjM < adjP × slack

**Properties of the erf-based slack factor:**
- erf(|skew|/√2) ∈ (0, 1): ranges from ~0 for symmetric distributions
  to ~1 for highly skewed distributions
- The CV term amplifies slack for high-uncertainty estimates (wide P−O
  range relative to mean)
- The (1 − p₀/0.5) term reduces slack as the scenario becomes easier
  (p₀ approaches or exceeds 50%), tightening the constraint when
  distributional accuracy matters most
- Combining these factors creates a three-way adaptive boundary:
  tight for symmetric easy estimates, loose for skewed difficult ones

**Three-attempt repair protocol:** Before disqualifying a configuration
that violates the feasibility condition, the system applies a sequential
repair:

    Attempt 1: adjO ← adjO × 0.95           [reduce optimistic 5%]
    Attempt 2: adjM ← adjM × 1.05           [expand most-likely 5%]
    Attempt 3: adjO ← min(adjO, adjM × 0.99) [hard clip to restore gap]

The repaired configuration is re-evaluated against the feasibility
condition after each attempt. If any attempt produces a feasible
configuration, it is accepted with no score penalty. Only if all three
repair attempts fail does the configuration receive the disqualification
score of −10¹², eliminating it from consideration.

**Effect:** The combination of erf-based slack and repair protocol
substantially reduces the fraction of parameter configurations
disqualified for feasibility violations, improving optimizer coverage
of the parameter space near the OMP boundary and reducing the
probability of the optimizer being trapped in a feasibility-constrained
local minimum at high slider values.

---

### XII. PERCENTILE REPOSITIONING (Core Output)

After optimization, the system reports:

1. **Baseline probability:** P_baseline(τ) = CDF_baseline(τ)
   The probability of completion by τ under standard PERT with no
   context adjustment.

2. **Optimized probability:** P_optimized(τ) = CDF_optimized(τ)
   The probability of completion by τ under the SACO-reshaped
   distribution.

3. **Probability lift:** ΔP = P_optimized - P_baseline
   The increase in confidence at τ attributable to project context.

4. **Optimal slider values:** S*₁,...,S*₇
   The configuration of project characteristics that maximizes P(τ)
   subject to the KL divergence constraint.

**Critical property — estimate preservation:**
The original O, M, P values are NEVER modified. The three-point
estimate represents the practitioner's learned judgment about the
task and is treated as a fixed parameter. SACO recontextualizes
the *percentile ranking* of τ within the distribution, not the
distribution's support.

---

### XII-A. STEP 7 OUTPUT-STAGE REVERSION GUARDS

After optimization completes and the final slider vector x is produced,
the system applies two independent reversion mechanisms before computing
the final output probability. These guards operate in sequence and are
architecturally separate from the leash penalty (which operates during
optimization) and the seed anchor (which operates during COBYLA
iterations).

#### A. Maximum Relative Deviation Threshold (0.50)

In adaptive mode, the system checks each element of the post-COBYLA
slider vector against the fixed-pass seed:

    For each i ∈ {0,...,6}:
        dev_i = |x[i] − seedBest[i]| / max(seedBest[i], 0.01)
        if dev_i > 0.50:
            x[i] ← seedBest[i] + 0.10 × (2 × rand() − 1)
            x[i] ← clamp(x[i], 0, 1)

Any slider that has drifted more than 50% relative to its seed is
replaced with a random perturbation centered on the seed with ±10%
range. This is a **hard boundary guard** — distinct from the leash
penalty's soft exponential form — that prevents the optimizer from
producing extreme outputs in dimensions where the COBYLA trajectory
has escaped the expected search region.

**Why 50% threshold:** The leash penalty (Section X) provides a
soft discouragement for deviations as small as 10–20%. The 50%
hard threshold catches cases where the leash was insufficient — for
example, when the objective function has a very strong gradient that
overcomes the leash near the boundary of a feasibility region, or
when numerical edge cases in the Cholesky sampling briefly produce
an anomalous objective landscape. The random perturbation re-seeds
the escaped slider near its anchor without zeroing it completely,
preserving some of the optimization progress in other dimensions.

#### B. Negative Lift Reversion Guard

After reshaping the distribution using the final slider vector and
computing the probability at τ under the reshaped distribution, the
system checks the probability lift:

    lift = P_reshaped(τ) − P_baseline(τ)

    if lift < −0.0001:
        → Zero all sliders: x ← [0, 0, 0, 0, 0, 0, 0]
        → Revert to baseline: reshapedPdf ← baselinePdf
                               reshapedCdf ← baselineCdf
        → Set finalProb ← P_baseline(τ),  lift ← 0

**Motivation:** This guard enforces the invariant that SACO
optimization never makes the practitioner's probability estimate
*worse* than the unoptimized PERT baseline. If the optimizer
converges to a slider configuration that, when fed through the
Beta refit, produces a distribution less favorable than the PERT
baseline at the target τ, the result is discarded entirely and
the baseline is returned verbatim. This can occur when:

- The OMP adjustment produces distribution bounds that shift
  rightward due to high rework scores dominating over favorable
  lever contributions.
- The moment computation returns negative m₀ values that cause
  the Beta refit to shift the mean above the baseline mean.
- Floating-point accumulation in the Cholesky/copula path produces
  a coupling signal that biases the hybrid moment in the wrong
  direction for this specific O/M/P/τ combination.

The guard is the final safety net in the SACO pipeline. It ensures
that the SACO system, as an estimation aid, satisfies the core
guarantee: the system produces context-adjusted distributions that
are no worse than naive PERT. A practitioner using SACO can trust
that providing management stance information will never reduce
their reported probability of success.

**Threshold −0.0001 (not zero):** A tolerance of 0.0001 (0.01
percentage points) is used rather than strict equality to avoid
false triggers from floating-point rounding in the CDF interpolation
step.

---

### XIII. MULTI-TASK AGGREGATION (EXTENSION)

The system extends to aggregate distributions across multiple tasks
via Monte Carlo convolution:

Given k tasks with independent reshaped distributions D₁,...,Dₖ:

    D_aggregate = D₁ ⊕ D₂ ⊕ ... ⊕ Dₖ

Where ⊕ denotes numerical convolution of the PDFs.
The aggregate distribution represents the total project duration under
the assumption that tasks are sequential (or partially parallel with
a specified overlap factor).

---

### XIV. ALTERNATIVE OPTIMIZATION STRATEGY (CONSERVATIVE PATH)

When the optimizer cannot achieve improvement over baseline (a condition
called "no-improve"), the system employs a conservative optimization
path that:

1. Identifies the 10th, 50th, and 90th percentile probe points
   of the baseline distribution
2. Applies a monotone lift function based on slider values
3. Returns the highest achievable probability without reshaping

This ensures the system always provides a meaningful result even in
edge cases where standard optimization fails.

---

### XIV-A. MANUAL-MODE FALLBACK CDF LIFT

When the user operates in manual mode (probeLevel = 0, with user-supplied
slider values) and the Beta distribution refit fails — either because the
method-of-moments system is ill-conditioned for the given slider
combination, or because the resulting Beta parameters are invalid — the
system falls back to a direct CDF-lift algorithm rather than returning
the unmodified baseline.

**Fallback CDF Lift Weight Vector:**

    W_LIFT = {
        budgetFlexibility:        +0.20,
        scheduleFlexibility:      +0.20,
        scopeCertainty:           +0.20,
        scopeReductionAllowance:  +0.15,
        reworkPercentage:         −0.15,
        riskTolerance:            +0.07,
        userConfidence:           +0.03
    }

Note that W_LIFT is distinct from the optimizer's PMBOK blend weight
W = [0.20, 0.20, 0.18, 0.15, 0.10, 0.09, 0.08] in three ways:
(a) reworkPercentage has a negative weight (−0.15 vs. +0.10) because
    in manual mode rework is taken at face value (not inverted);
(b) riskTolerance has a lower weight (0.07 vs. 0.09), reflecting that
    in the absence of copula processing, risk tolerance has less
    systematic distributional effect;
(c) userConfidence has a lower weight (0.03 vs. 0.08), reflecting
    maximum conservatism toward self-reported confidence when the
    primary refit path is unavailable.

**Lift computation:**

    raw = Σₖ W_LIFT[k] × normalized01[k]

    gain = clamp(raw, −0.25, +0.25) × 0.25    [maxDelta = 0.25]

    For each CDF point (x, F):
        lifted_F = clamp(F + gain × (1 − F), 0, 1)

The formula `F + gain × (1 − F)` lifts the CDF upward by a fraction
`gain` of the remaining probability above F. This ensures:
- The lift is largest where the CDF has the most headroom (near F=0)
- The lift approaches zero as F → 1 (CDF tail is preserved)
- The final CDF remains monotone and bounded in [0, 1]

**Maximum lift:** The double cap (clamp raw to ±0.25, then multiply by
0.25) limits the maximum gain to ±0.0625 (6.25 percentage points of
CDF headroom). This is intentionally conservative for a fallback path
that bypasses the full moment-computation and Beta-refit pipeline.

**Post-lift guardrail:** After applying the lift, the system checks
whether the lifted probability at τ is below the baseline probability.
If so, the lift is rejected and the baseline distribution is returned
unchanged. This prevents an inadvertent negative-weight configuration
(dominated by high rework) from worsening the practitioner's estimate.

---

### XV. SENSITIVITY ANALYSIS EXTENSION

The system additionally computes individual slider sensitivity by
evaluating the objective function at incremental perturbations of
each slider while holding others fixed. This produces a sensitivity
vector:

    ∂P/∂Sᵢ  for each i ∈ {1,...,7}

Reported as a tornado chart showing which project characteristics
have the greatest influence on the probability of completion at τ.
This guides practitioners toward the highest-value risk mitigation
actions.

---

---

### XVI. USER-CONTROLLED WEIGHT ARCHITECTURE

The SACO system exposes its internal weights and constraints through a
four-tier progressive disclosure architecture, allowing practitioners to
understand and override the mathematical foundations without requiring
knowledge of the underlying theory.

#### A. The Five Controllable Weights

**1. PERT Mode Weight (λ)**

The canonical PERT formula weights the most-likely estimate M by λ:

    Mean(λ) = (O + λ×M + P) / (λ + 2)
    α(λ)    = 1 + λ×(M - O)/range
    β(λ)    = 1 + λ×(P - M)/range

The system exposes λ ∈ {2, 4, 6}:
- λ=2: Equal weight to all three points (uniform-like)
- λ=4: PMBOK standard (Malcolm et al. 1959, US Navy Polaris program)
- λ=6: High confidence in modal estimate (well-calibrated estimators)

Research basis: Golenko-Ginzburg (1988) tested λ ∈ [2,8] across
engineering domains and found λ=4–6 most robust. The choice of λ=4
as the PMBOK standard is a 65-year empirical consensus.

**2. KDE Bandwidth (smoothing)**

The Gaussian kernel density estimation bandwidth h = gridRange/63.3
is derived from Silverman's rule-of-thumb (1986) evaluated at n=2000
with σ ≈ range/6. The system allows users to deviate from Auto:
- Sharp: h ← h × 0.5 (spikier PDF, tracks samples closely)
- Auto: h = gridRange/63.3 (Silverman rule, default)
- Smooth: h ← h × 1.5 (wider PDF, robust to outliers)

**3. Copula Correlation Preset**

The 7×7 BASE_R matrix encodes organizational risk interdependencies.
The system offers three named presets:
- Independent: BASE_R = I₇ (no correlation between slider dimensions)
- PMBOK Standard: BASE_R as defined in Section VII (default)
- Tightly Coupled: all off-diagonal entries scaled by 1.5 (saturated
  correlation, more pessimistic joint risk estimation)

The PMBOK Standard preset is derived from PMI Risk Practice Standard
and Flyvbjerg et al. (2002) empirical overrun correlation analysis.

**4. Optimizer Fidelity Weight (KL)**

The exp(-KL) penalty term in the objective function is controlled by
a fidelity parameter κ ∈ [0, 1]:

    effective KL weight = κ × KL_raw

κ=1.0 (Strict): Result stays close to baseline — auditable, conservative
κ=0.3 (Loose): Allows larger divergence — higher probability potential

**5. Leash (Operational Change Bound)**

The exp(-leash_penalty) term is controlled by a leash parameter
λ_leash ∈ [0, 1] representing the maximum fractional displacement of
any slider from its user-set value:

    leash_penalty = max(0, displacement - λ_leash × range)²

λ_leash=0.15 (Small): SACO recommends minor operational adjustments
λ_leash=0.50 (Large): SACO may recommend substantial operational changes

#### B. Four-Tier Disclosure Architecture

The system surfaces these weights through a layered interface:

**Tier 1 — Always Visible (all users):**
- O, M, P, target τ inputs
- 7 slider controls with plain-language questions per dimension
- Mode selection: You Decide / Quick Find / Deep Find
- Per-slider probability delta: live readout of each slider's marginal
  contribution to P(X≤τ)

**Tier 2 — Run Options Popover (motivated users):**
- Optimize for: hit target / minimize mean / reduce P90
- Baseline fidelity (KL weight): Strict ↔ Loose slider
- Operational change allowed (leash): Small ↔ Large slider
- Search depth (probe level 1–7)
- PERT mode weight (λ): Conservative / Standard / Confident

**Tier 3 — Advanced Controls (technical users):**
- Baseline smoothing: Auto / Sharp / Smooth
- Copula preset: Independent / PMBOK / Tightly Coupled / Custom
- Historical Context: priorHistory input with Bayesian posterior display

**Tier 4 — Methodology Footnotes (auditors / executives):**
- Static citations to Malcolm et al. (1959), Silverman (1986),
  Kullback & Leibler (1951), McKay et al. (1979), PMI Risk Standard,
  Flyvbjerg et al. (2002), Kahneman & Tversky (1979)
- Decision analysis foundations: Howard (1968), Howard & Matheson (1984),
  Spetzler & Staël von Holstein (1975)
- Management stance and controllable conditions: Chapman & Ward (2003),
  PMBOK §11.3.2.3, Kahneman & Lovallo (2003), Flyvbjerg (2008)
- Calibration and user confidence: Hubbard (2014)
- Surfaced in report export, not in the main UI

---

### XVII. OPTIMIZER EXPLAINER — "WHY THIS RESULT?" PANEL

After each optimization run, the system generates a natural-language
explanation of the optimizer's decisions through the following process:

**Step 1: Force decomposition**

The three forces in the objective function are represented as
proportional bars:

    target_contribution  ∝ (1 - κ × 0.2 - λ_leash × 0.1)
    kl_contribution      ∝ κ × 0.6
    leash_contribution   ∝ λ_leash × 0.4

**Step 2: Slider delta table**

For each of the 7 slider dimensions, the system computes:

    Δᵢ = S*ᵢ - S_user_ᵢ

Where S*ᵢ is the optimizer-recommended value and S_user_ᵢ is the
user's current manual setting. Deltas are sorted by |Δᵢ| × wᵢ
(magnitude × PMBOK weight) to identify the highest-leverage changes.

**Step 3: Summary**

A natural-language summary reports the total probability lift
(ΔP = P_optimized - P_baseline) and identifies the primary driver
(the slider with the largest weighted delta).

**Step 4: Chaining Drift**

When the adaptive pass is active, the explainer also reports a
**chaining drift metric** measuring how far the adaptive-pass
output has drifted from the fixed-pass seed:

    chainingDrift =
        (Σᵢ |sliders*[i] − seedBest[i]|) / 7 / mean(seedBest) × 100

where sliders*[i] are the final adaptive-pass slider values in [0,1]
space, seedBest[i] are the fixed-pass seed values, mean(seedBest) is
the arithmetic mean of the seven seed values, and the result is
expressed as a percentage.

**Interpretation:**
- chainingDrift near 0: the adaptive pass made only minor refinements
  to the fixed pass result — the answer is robust and seed-consistent.
- chainingDrift 10–30: meaningful optimization took place; the
  adaptive pass found a meaningfully better region than the fixed pass.
- chainingDrift > 50: the adaptive pass significantly departed from
  the seed — check whether the result reflects genuine optimization
  or boundary-region instability. The max-deviation guard (Section
  XII-A) bounds individual slider drift at 50% relative, but
  aggregate drift across all seven sliders can still be substantial.

Chaining drift is reported in the narrative alongside lift and mode
to give practitioners a diagnostic signal about result stability.

This explainer transforms the optimizer from a black box into a
transparent advisor, enabling practitioners to evaluate whether
the recommended changes are operationally realistic before acting
on them.

---

## CLAIMS

*(Note: These are informal claims suitable for a provisional patent
application. Claims will be formalized by a patent attorney for the
non-provisional filing.)*

**Claim 1 (Independent — Method):**
A computer-implemented method for probabilistic project duration
estimation comprising:
(a) receiving a three-point project duration estimate comprising an
optimistic value O, a most-likely value M, and a pessimistic value P;
(b) receiving a plurality of project characteristic parameters
classified as management stance inputs — decision node values in the
Howard-Matheson influence diagram formalism whose values are set by the
practitioner as policy commitments, not sampled as uncertain random
variables — comprising at least budget flexibility, schedule flexibility,
scope certainty, scope reduction allowance, rework percentage, risk
tolerance, and user confidence;
(c) applying a Gaussian copula transformation to said project
characteristic parameters using a correlation matrix derived from
project management theory to produce copula-transformed values
reflecting realistic statistical dependencies between said parameters;
(d) computing a hybrid moment adjustment function comprising:
    (i) a linear weighted aggregation of said copula-transformed
        parameters using PMBOK-derived weights;
    (ii) a probabilistic disjunction of said copula-transformed
         parameters; and
    (iii) an interpolation between (i) and (ii) using an interpolation
         weight determined by the copula coupling coefficient;
(e) refitting a Beta probability distribution using method-of-moments
estimation applied to the adjusted moments from step (d);
(f) executing a two-stage optimization comprising Latin Hypercube
Sampling global search followed by COBYLA local refinement to find
project characteristic values maximizing the probability of completion
at a target duration value;
(g) applying a Kullback-Leibler divergence penalty in the optimization
objective function to prevent unrealistic departure from the baseline
PERT distribution; and
(h) repositioning the target duration value's percentile within the
reshaped distribution without modifying the original O, M, P values.

**Claim 2 (Dependent on Claim 1):**
The method of Claim 1, wherein the interpolation weight t in step (d)(iii)
is computed as:
    t = clamp(0.3 + 0.4 × coupling, 0, 1)
where coupling is the mean of the copula-transformed values U₁,...,U₇.

**Claim 3 (Dependent on Claim 1):**
The method of Claim 1, wherein the variance adjustment m₁ exhibits an
inverse relationship with the linear aggregation lin:
    variance_factor = 0.8 - 0.5 × lin
preventing double-penalization of estimates that already incorporate
wide optimistic-pessimistic ranges.

**Claim 4 (Dependent on Claim 1):**
The method of Claim 1, wherein the KL divergence penalty in the
optimization objective is computed as:
    score = P(τ)^(1+bb) × exp(-KL(P_baseline || P_reshaped))
constraining maximum allowable distribution reshaping to approximately
5% divergence from the PERT baseline.

**Claim 5 (Dependent on Claim 1):**
The method of Claim 1, wherein the Gaussian copula correlation matrix
includes negative correlations between rework percentage and scope
certainty, and positive correlations between risk tolerance and user
confidence, derived from Project Management Body of Knowledge knowledge
area interdependency analysis.

**Claim 6 (Dependent on Claim 1):**
The method of Claim 1, further comprising aggregating reshaped
distributions across a plurality of project tasks by numerical
convolution of individual probability density functions to produce
an aggregate project duration distribution.

**Claim 7 (Dependent on Claim 1):**
The method of Claim 1, further comprising computing a sensitivity
vector by partial evaluation of the optimization objective with respect
to each project characteristic parameter, and displaying said
sensitivity as a tornado chart to guide practitioner risk mitigation.

**Claim 8 (Independent — System):**
A system for context-aware probabilistic project duration estimation
comprising:
(a) a user interface accepting a three-point project duration estimate
and a seven-dimensional project characteristic parameter vector via
interactive slider controls;
(b) a Gaussian copula processor modeling statistical dependencies
between said project characteristic parameters;
(c) a hybrid moment mapping engine computing adjusted Beta distribution
parameters via interpolation between linear weighted aggregation and
probabilistic disjunction, with copula-determined interpolation weight;
(d) a two-stage optimizer executing Latin Hypercube Sampling followed
by COBYLA refinement with Kullback-Leibler divergence constraint; and
(e) a distribution renderer displaying original and reshaped probability
density and cumulative distribution functions overlaid on a common axis.

**Claim 9 (Independent — Computer-Readable Medium):**
A non-transitory computer-readable medium storing instructions that,
when executed by a processor, perform Shape-Adaptive Copula Optimization
(SACO) comprising the steps of Claims 1 through 7.

**Claim 10 (Independent — Bayesian MCMC Baseline Extension):**
A computer-implemented method extending the method of Claim 1, wherein
Stage 1 baseline generation further comprises:
(a) accepting a historical context parameter comprising a count N of
    similar past projects, a mean overrun fraction relative to PERT
    predicted values, and an optional standard deviation of overrun;
(b) placing a Student-t prior with ν=4 degrees of freedom, location 0,
    and scale σ_prior=0.30 over the organizational overrun rate μ_overrun,
    yielding the log-prior:
        log p(μ) ∝ −(ν+1)/2 · log(1 + μ²/(ν · σ²_prior))
    said heavy-tailed prior conferring robustness against outlier
    historical projects relative to a Normal prior;
(c) sampling the intractable posterior p(μ_overrun | data) using a
    random-walk Metropolis-Hastings Markov Chain Monte Carlo algorithm
    comprising: a total chain length of 5500 iterations; a burn-in
    period of 500 iterations discarded before sample collection to
    allow the chain to reach stationarity; thinning by a factor of 5
    to reduce inter-sample autocorrelation, yielding 1000 effective
    posterior chain samples; and a Gaussian random-walk proposal with
    standard deviation 0.5·σ_prior targeting an acceptance rate of
    approximately 0.30–0.40;
(d) for each of the numSamples PERT base draws, selecting a posterior
    overrun value μ_k by cycling through the 1000 chain samples, then
    computing an adjusted sample as:
        adjusted_i = s_i × (1 + μ_k + σ_obs · N(0,1))
    thereby propagating both epistemic uncertainty (via the chain) and
    aleatoric per-project variability (via σ_obs) into the distribution;
(e) applying Gaussian KDE over an extended grid whose upper bound is
    P × (1 + max(0, chainMean + 3·chainStd)), accommodating the
    overrun-shifted tail beyond the pessimistic estimate;
(f) when no historical context is provided, reverting to standard i.i.d.
    Beta Monte Carlo sampling, with all downstream stages operating
    identically on either baseline.

**Claim 11 (Dependent on Claim 10):**
The method of Claim 10, wherein a credibility indicator
credibility = min(1, N/10) is computed and displayed to the
practitioner, communicating the statistical strength of the
historical signal on a 0–1 scale.

**Claim 12 (Independent — User-Controlled Weight Architecture):**
A computer-implemented system for context-aware probabilistic project
duration estimation comprising:
(a) a user interface implementing a four-tier progressive disclosure
    architecture exposing mathematical weights and constraints at
    levels of increasing technical sophistication;
(b) a Tier 1 interface comprising: three-point estimate inputs,
    seven project characteristic sliders, and per-slider real-time
    probability delta readouts showing each slider's marginal
    contribution to P(X≤τ);
(c) a Tier 2 run options control exposing: optimization objective
    selection (target / mean / P90), a baseline fidelity parameter
    controlling KL divergence penalty weight, a leash parameter
    controlling maximum slider displacement from user values, search
    depth (probe level 1–7), and PERT mode weight λ ∈ {2, 4, 6};
(d) a Tier 3 advanced controls interface exposing: KDE bandwidth
    smoothing, Gaussian copula correlation matrix preset selection,
    and historical context input for Bayesian baseline updating;
(e) each exposed parameter accompanied by a plain-language description
    of its trade-off and a citation to the research basis for its
    default value.

**Claim 14 (Independent — Decision Node Architecture):**
A computer-implemented method for probabilistic project estimation
comprising:
(a) explicitly classifying estimation inputs into two distinct categories:
    (i) outcome uncertainty inputs comprising a three-point estimate
        (O, M, P) treated as a probability distribution over uncertain
        project duration outcomes; and
    (ii) management stance inputs comprising a plurality of project
         characteristic parameters treated as decision node values set
         by the practitioner as policy commitments, wherein said
         parameters are classified as decision nodes by application of
         the clarity test: each parameter's value is determined by
         practitioner intent rather than by observation of an external
         uncertain state;
(b) computing a conditional probability distribution P(duration |
    management stance) by applying a Gaussian copula transformation
    to the management stance inputs, wherein said copula models
    organizational dependencies between management policy decisions
    rather than statistical dependencies between uncertain random
    variables;
(c) computing adjusted distribution moments from the copula-transformed
    management stance inputs and applying said moments to reshape the
    outcome uncertainty distribution; and
(d) reporting the conditional probability P(duration ≤ τ | management
    stance) as the primary system output, representing the probability
    of project completion at or before a target value given the
    practitioner's stated management policy.

**Claim 15 (Dependent on Claim 14):**
The method of Claim 14, wherein the management stance inputs are
further constrained by a Kullback-Leibler divergence penalty ensuring
that no management stance, however favorable, can produce a conditional
distribution that diverges from the practitioner's outcome uncertainty
distribution by more than approximately 5%, thereby preventing
management stance inputs from overriding the practitioner's learned
judgment embedded in O, M, P.

**Claim 16 (Independent — PSD Jitter and Cholesky Stabilization):**
A computer-implemented method for stable Gaussian copula computation
in a project estimation system comprising:
(a) applying a diagonal jitter of 1×10⁻³ to each diagonal entry of a
    management-stance correlation matrix prior to any matrix operation
    requiring positive semi-definiteness, guaranteeing numerical PSD
    stability without material alteration of off-diagonal correlation
    values;
(b) applying a secondary ε·I shift with ε = 1×10⁻⁹ inside the
    Cholesky factorization algorithm as a guard against near-zero
    diagonal remainders during factorization; and
(c) generating correlated management stance z-score vectors as
    z_corr = L × z_iid, where L is the lower Cholesky factor and
    z_iid are independent standard normal vectors, such that the
    joint distribution of generated values reproduces the covariance
    structure of the management-theoretic correlation matrix.

**Claim 17 (Independent — Ambition Detection):**
A computer-implemented method for adaptive objective function
computation in a probabilistic project estimation optimizer comprising:
(a) computing the PERT baseline mean μ_base = (O + 4M + P)/6 and the
    baseline probability p₀ = P_baseline(τ) prior to any optimization;
(b) detecting an ambitious estimation scenario defined as the
    simultaneous satisfaction of: (i) target value τ > μ_base, and
    (ii) baseline probability p₀ > 0.50; and
(c) when the ambitious scenario is detected, setting the bias exponent
    bb to zero in the optimization objective
        score = P(τ)^(1+bb) × exp(−KL) × exp(−leash_penalty),
    thereby preventing artificial amplification of already-favorable
    probability scores in low-difficulty estimation scenarios and
    maintaining score comparability across the full range of
    estimation contexts from hard to easy.

**Claim 18 (Independent — Difficulty-Adaptive Relative-Deviation Exponential Leash):**
A computer-implemented method for constraining optimization
recommendations in a project estimation system comprising:
(a) computing a difficulty-scaled leash coefficient
        λ_leash = 0.05 × (1 − p₀)
    where p₀ is the baseline probability of completion at the target
    value, such that the coefficient scales toward zero as the estimation
    scenario becomes easier (higher p₀) and toward 0.05 as it becomes
    harder (lower p₀);
(b) for each of the plurality of project characteristic parameters,
    computing a relative deviation normalized by the seed slider value:
        dev_i = |S*ᵢ − seed_i| / max(seed_i, 0.01)
    where S*ᵢ are current candidate slider values and seed_i are the
    values found by the initial (non-adaptive) optimization pass;
(c) accumulating an exponential per-slider penalty:
        raw_leash = Σᵢ λ_leash × exp(dev_i / 0.1)
(d) applying a threshold subtraction before the objective:
        leash_penalty = max(0, raw_leash − 1.0)
    such that aggregate deviations up to a total accumulated term of 1.0
    incur no penalty (a "free zone"), and only excess beyond that threshold
    contributes to the exp(−leash_penalty) factor in the objective; and
(e) incorporating said penalty as the third multiplicative factor in
    the optimization objective exp(−leash_penalty), creating a
    difficulty-adaptive constraint that penalizes large relative deviations
    more severely in hard estimation scenarios and provides a free zone
    that allows legitimate exploratory freedom near the seed.

**Claim 19 (Independent — Taming Factor):**
A computer-implemented method for probe-level-dependent objective
function scaling comprising:
(a) accepting a probe level parameter probeLevel ∈ {0, 1, 2, 3, 4, 5, 6, 7}
    controlling the depth of global LHS search and local COBYLA
    refinement in a two-stage optimization;
(b) computing a taming factor
        taming_factor = 1 + 0.01 / (probeLevel + 1);
    and
(c) multiplying the optimization objective score by said taming factor,
    creating a monotonically decreasing exploration bonus as probe
    level increases, thereby providing a mild preference for solutions
    found at any probe level that declines as search depth increases,
    preventing the optimizer from over-committing to extreme
    configurations discovered only through exhaustive high-depth search
    while having negligible effect (< 1%) on the optimization outcome
    in normal operation.

**Claim 20 (Independent — erf-Based Monotone Feasibility with Repair):**
A computer-implemented method for distribution-adaptive feasibility
checking in a project duration estimation optimizer comprising:
(a) computing distribution statistics from the PERT baseline:
        CV     = σ_base / μ_base           [coefficient of variation]
        skew   = (μ_base − M) / σ_base    [skewness proxy]
        p₀     = P_baseline(τ)            [baseline probability];
(b) computing a distribution-dependent feasibility slack factor:
        slack = 1 + 0.05 × CV × (1 − p₀/0.5) × erf(|skew| / √2),
    ranging from near-unity for symmetric low-uncertainty estimates
    to larger values for highly skewed, high-uncertainty estimates,
    with the slack reduced when the baseline probability already
    exceeds 50%;
(c) evaluating the monotone feasibility conditions as:
        adjO < adjM × slack  AND  adjM < adjP × slack,
    such that the constraint is strictest for symmetric easy estimates
    and most permissive for skewed difficult estimates; and
(d) when a feasibility violation is detected, executing a sequential
    three-attempt repair protocol before disqualifying the
    configuration: (i) reduce adjO by 5%; (ii) increase adjM by 5%;
    (iii) clip adjO to min(adjO, adjM × 0.99); accepting the
    configuration if any repair attempt succeeds, and assigning the
    disqualification score of −10¹² only if all three repair attempts
    fail.

**Claim 21 (Dependent on Claim 1 — Risk Tolerance as Exclusive OMP Non-Participant):**
The method of Claim 1, wherein one of the plurality of project
characteristic parameters is a Risk Tolerance parameter S₆ whose
computational role is partitioned such that:
(a) S₆ does NOT appear in the objective function OMP transform formula
    (Section XI.A): O', M', P' are computed without any S₆ term, making
    Risk Tolerance the only slider among the seven that does not participate
    in adjusting the distribution support bounds; and
(b) S₆ contributes to the bias exponent bb through its term in the
    all-slider bb formula:
        bb = 0.05 + 0.03 × mean(W_MEAN[i] × S₀₁[i] × sign(W_MEAN[i]))
    where W_MEAN[5] = +0.25 for Risk Tolerance — the second-highest
    magnitude in the W_MEAN vector — giving Risk Tolerance a dominant
    but not exclusive influence on bb; and
(c) S₆ also appears in the feasibility check OMP transform (Section XI.B)
    where adjP_feas = P × (1 + S₆ × 0.25), contributing to the boundary
    stress test used to validate the ordering constraint — a different
    role from the objective function OMP transform.
The net result is that Risk Tolerance's exclusive mechanistic role in the
objective function is bb amplification: it is the only slider that cannot
shift the distribution leftward to increase P(τ) directly — it can only
affect the magnitude of the probability exponent in the objective.

**Claim 22 (Independent — Thesis Path and 50/50 Hybrid Moment Blend):**
A computer-implemented method for computing hybrid adjusted distribution
moments in a probabilistic project estimation system comprising:
(a) computing a first moment estimate via the copula path comprising:
    (i) a linear weighted aggregation m₀_lin = Σᵢ Wᵢ × S₀₁[i] using
        PMBOK-derived blend weights W summing to 1.0;
    (ii) a probabilistic disjunction m₀_OR = 1 − Πᵢ(1 − 0.9 × S₀₁[i]);
    (iii) a copula coupling interpolation m₀_copula = (1−t)×m₀_lin + t×m₀_OR
        where t = clamp(0.3 + 0.4 × coupling, 0, 1); and
    (iv) a variance adjustment m₁_copula = (0.8 − 0.5 × lin) × (1 + CV/2);
(b) computing a second moment estimate via the thesis path comprising:
    (i) a signed directional weight vector W_MEAN whose components may be
        negative, reflecting that favorable levers reduce expected duration;
    (ii) a diagonal scaling weight vector DIAG_W reflecting each lever's
        independent magnitude contribution;
    (iii) m₀_thesis = Σᵢ S₀₁[i] × W_MEAN[i] × DIAG_W[i], clamped to [−0.8, 0.8];
    (iv) a variance thesis weight vector W_VAR; and
    (v) m₁_thesis = Σᵢ S₀₁[i] × W_VAR[i] × DIAG_W[i] × (1 + CV/2),
        clamped to [0, 1.5];
(c) blending the two paths with equal weights:
        hybrid_m₀ = 0.5 × m₀_copula + 0.5 × m₀_thesis
        hybrid_m₁ = 0.5 × m₁_copula + 0.5 × m₁_thesis;
    and
(d) using hybrid_m₀ and hybrid_m₁ as inputs to the Beta distribution
    refit (method-of-moments estimation) that generates the reshaped
    probability distribution.
The 50/50 blend inherits the information-theoretic grounding of the
copula path and the signed-directional accuracy of the thesis path,
producing a moment estimate that is both theoretically motivated and
empirically calibrated to the PMBOK lever directionality literature.

**Claim 23 (Independent — Two-Pass Optimization Workflow):**
A computer-implemented method for two-stage probabilistic project
estimation optimization comprising:
(a) executing a first optimization pass with fixed non-adaptive
    parameters (probeLevel=1, adaptive=false) using a degenerate
    single-point LHS evaluation and a short COBYLA refinement
    (maxIter=5) to produce a coarse seed slider vector seedBest;
(b) executing a second optimization pass with adaptive parameters
    (adaptive=true, probeLevel=user-specified) using full LHS
    sampling with n = max(100, 50 × probeLevel) sample points, full
    COBYLA refinement (maxIter=100), and the following mechanisms
    that depend on seedBest from pass (a):
    (i) the difficulty-adaptive leash penalty (Section X) anchored
        to seedBest, penalizing relative deviation from the first-pass
        seed;
    (ii) the every-10-iteration seed anchor in COBYLA that detects
         drift exceeding 8% relative deviation and applies 80% lerp
         toward seedBest; and
    (iii) the bias exponent bb formula and ambition detection
         (Section X-A) active only in the adaptive pass;
(c) returning the adaptive-pass output as the final result; and
(d) computing and reporting a chaining drift metric
        chainingDrift = (Σᵢ |x*ᵢ − seedBest[i]|) / 7 / mean(seedBest) × 100
    measuring the aggregate relative departure of the adaptive-pass
    slider vector from the fixed-pass seed, expressed as a percentage,
    for use as a diagnostic signal about result stability.

**Claim 24 (Independent — Negative Lift Reversion Guard):**
A computer-implemented method for guaranteeing monotone improvement
in probabilistic project estimation comprising:
(a) after optimization and distribution reshaping, computing the
    probability lift:
        lift = P_reshaped(τ) − P_baseline(τ);
(b) detecting a degradation condition defined as lift < −0.0001;
(c) when the degradation condition is detected, executing a full
    reversion comprising: (i) zeroing all seven slider values to
    zero; (ii) replacing the reshaped probability density and
    cumulative distribution functions with the unmodified baseline
    PERT distributions; and (iii) setting the reported probability
    to P_baseline(τ) and the lift to zero; and
(d) guaranteeing to the practitioner that the SACO system will never
    report a probability of project completion at τ that is lower
    than the unadjusted PERT baseline, providing a monotone
    improvement guarantee as a core system invariant.
The threshold of −0.0001 (rather than strict zero) accommodates
floating-point rounding in CDF interpolation without triggering false
reversions from numerical noise.

**Claim 25 (Independent — BENCH-Bounded Adaptive LHS with Warm-Start Trial Override):**
A computer-implemented method for bounded Latin Hypercube Sampling
in a project estimation optimizer comprising:
(a) defining a per-dimension benchmark upper bound array
        BENCH = [75, 75, 60, 50, 25, 50, 50]
    (expressed as percentages for budget flexibility, schedule
    flexibility, scope certainty, scope reduction allowance, rework
    percentage, risk tolerance, and user confidence respectively);
(b) computing effective per-dimension LHS upper bounds as:
        hi_d = min(PER_SLIDER_BOUNDS[d].hi, BENCH[d] / 100)
    such that the LHS search space is restricted to operationally
    realistic upper limits rather than the full [0,1] unit hypercube;
(c) generating n = max(100, 50 × probeLevel) LHS sample points
    in the bounded hypercube in adaptive mode (or n=250 in non-adaptive
    mode), where probeLevel ∈ {1,...,7} controls exploration depth;
(d) constructing a warm-start trial set from the first 50 LHS samples
    by overriding the last four slider dimensions with fixed
    initialization values:
        trial = (s₀, s₁, s₂, 0.50, 0.25, 0.50, 0.50)
    retaining the budget, schedule, and scope LHS values while
    initializing scope reduction, rework, risk tolerance, and user
    confidence at their midpoint values; and
(e) maintaining a default fallback slider vector
        pmDefaults = [0.65, 0.65, 0.60, 0.15, 0.25, 0.50, 0.50]
    for use when no LHS evaluation improves on the baseline probability,
    representing a conservatively favorable management stance from which
    the adaptive pass can be seeded.

**Claim 13 (Independent — Optimizer Explainer):**
A computer-implemented method for generating natural-language
explanations of optimization results in the method of Claim 1,
comprising:
(a) decomposing the SACO objective function into its three component
    forces and representing their relative contributions as
    proportional visual indicators;
(b) computing per-slider delta values Δᵢ = S*ᵢ - S_user_ᵢ comparing
    optimizer-recommended slider values to practitioner-supplied
    values, sorted by |Δᵢ| × wᵢ where wᵢ are PMBOK-derived weights;
(c) generating a natural-language summary identifying the highest-
    leverage slider change, the total probability lift ΔP, and
    whether the recommended changes are within the user-specified
    operational leash bound;
(d) displaying said explanation in a dedicated panel adjacent to
    the reshaped distribution charts, enabling practitioners to
    evaluate the operational feasibility of optimizer recommendations
    before acting on them.

---

## ABSTRACT

A computer-implemented system and method termed Shape-Adaptive Copula
Optimization (SACO) addresses the context-blindness of standard PERT
and Monte Carlo project estimation by repositioning a target duration
value's percentile within a probability distribution based on seven
project characteristic parameters without modifying the practitioner's
original three-point estimate. The system incorporates five novel
contributions: (1) A formal two-category input architecture explicitly
separating outcome uncertainty inputs (the three-point estimate O, M, P,
treated as a probability distribution over uncertain durations) from
management stance inputs (seven project characteristic parameters
classified as decision nodes in the Howard-Matheson influence diagram
formalism, whose values are set by the practitioner as policy commitments
rather than sampled as uncertain random variables); the Gaussian copula
is applied to model organizational dependencies between these decision
nodes — a novel application of copula theory to a decision node vector
rather than a chance node vector. (2) A Gaussian copula with a
project-management-theoretic correlation matrix models realistic
dependencies between parameters including budget flexibility, schedule
flexibility, scope certainty, scope reduction allowance, rework
percentage, risk tolerance, and user confidence. (3) A hybrid moment
mapping function interpolates between conservative linear weighted
aggregation and pessimistic probabilistic disjunction, with interpolation
weight dynamically determined by the copula coupling coefficient.
(4) A two-stage optimization combining Latin Hypercube Sampling and
COBYLA local refinement maximizes the probability of completion at the
target value subject to a Kullback-Leibler divergence constraint.
(5) An optional Bayesian MCMC baseline extension employs a
Metropolis-Hastings Markov Chain Monte Carlo sampler with a
Student-t(ν=4) prior over the organizational overrun rate; the
heavy-tailed prior confers robustness against outlier historical
projects relative to conjugate Normal approaches; a 500-iteration
burn-in and thinning-by-5 yield 1000 effective posterior chain samples
which are cycled through per PERT draw to inject both epistemic and
aleatoric uncertainty into the baseline; the system reverts
automatically to standard i.i.d. PERT sampling when no history is
provided. The system further exposes all internal weights and constraints
through a four-tier progressive disclosure architecture with
plain-language descriptions and research citations, and generates
natural-language optimizer explanations comparing recommended slider
values to practitioner-supplied values, sorted by PMBOK-derived
importance weights.

Six additional innovations strengthen and complete the SACO pipeline:
(6) PSD Jitter — a 1×10⁻³ diagonal stabilizer applied to BASE_R
before Cholesky decomposition, with a secondary 1×10⁻⁹ ε·I shift
inside the Cholesky algorithm, providing two-level numerical stability
across all copula presets; (7) Ambition Detection — an automatic
bb=0 override when the target exceeds the PERT mean and baseline
probability already exceeds 50%, preventing artificial amplification
of already-favorable scenarios and ensuring score comparability across
the difficulty spectrum; (8) Taming Factor — taming_factor =
1+0.01/(probeLevel+1), a probe-level-dependent objective scaling
that decays as search depth increases, preventing over-commitment to
extreme configurations found only through exhaustive search; (9)
Exponential Leash Penalty — λ_leash = 0.05×(1−p₀) with per-slider
exponential form Σλ×(exp(|Δs|/0.1)−1), a difficulty-adaptive anchor
to practitioner-supplied slider values that tightens proportionally
as the estimation scenario becomes harder; (10) erf-Based Monotone
Feasibility — slack = 1+0.05×CV×(1−p₀/0.5)×erf(|skew|/√2) with a
three-attempt repair protocol (5% adjO reduction; 5% adjM expansion;
hard clip), replacing binary feasibility rejection with a smooth
context-sensitive boundary; and (11) Two-Formula OMP Architecture — the system uses two distinct
OMP transformation formulas: one for the objective function Beta refit
(favorable-direction coefficients that shift distributions leftward)
and one for the monotone feasibility stress test (worst-case expansion
coefficients); these serve different computational roles and use
different sign conventions for scope certainty and risk tolerance.
(12) All-Slider bb Formula — the bias exponent
bb = 0.05 + 0.03 × mean(W_MEAN[i] × S₀₁[i] × sign(W_MEAN[i])) uses
the W_MEAN vector across all seven sliders, with Risk Tolerance (S₆)
having the dominant non-budget influence (W_MEAN[5] = +0.25) but NOT
exclusively controlling bb.
(13) 50/50 Thesis-Copula Hybrid Blend — the moment computation
blends a copula path (lin/OR/coupling) with a thesis path (signed
W_MEAN directional weights with DIAG_W scaling) at equal 0.5 weight,
producing hybrid_m₀ and hybrid_m₁ that inherit both theoretical
grounding and empirical calibration to PMBOK lever directionality.

Seven further innovations complete the system architecture:
(14) Two-Pass Optimization Architecture — the optimizer executes a
fixed pass (probeLevel=1, non-adaptive, degenerate single-point LHS,
5-iteration COBYLA) to produce a coarse seed, followed by an adaptive
pass (full LHS with n=max(100,50×probeLevel), maxIter=100 COBYLA) that
uses the fixed-pass result as the leash anchor and seed-anchor target;
the two-pass structure solves the cold-start problem, enables the leash
mechanism, and improves result reproducibility across probe levels.
(15) Negative Lift Reversion Guard — after reshaping, the system checks
lift = P_reshaped(τ)−P_baseline(τ); if lift < −0.0001, all sliders are
zeroed and the baseline distribution is restored verbatim, guaranteeing
the monotone improvement invariant that SACO never makes the practitioner's
probability estimate worse than unadjusted PERT.
(16) BENCH-Bounded LHS with Warm-Start Trial Override — LHS sampling is
restricted to BENCH = [75,75,60,50,25,50,50] upper bounds (per-dimension
operationally calibrated caps); warm-start trials override the last four
slider dimensions to (s₀,s₁,s₂,0.50,0.25,0.50,0.50) for the first 50
samples; a pmDefaults fallback [0.65,0.65,0.60,0.15,0.25,0.50,0.50] seeds
the adaptive pass when no LHS evaluation improves on baseline.
(17) Manual-Mode Fallback CDF Lift — when the Beta refit fails in manual
mode, the system applies a direct lift gain = clamp(Σ W_LIFT[k]×s_k, ±0.25)
× 0.25 to the baseline CDF via F + gain×(1−F), with weight vector
W_LIFT = [+0.20,+0.20,+0.20,+0.15,−0.15,+0.07,+0.03] and maxDelta=0.25,
ensuring a conservative monotone estimate is always returned.
(18) Chaining Drift Metric — the explainer reports chainingDrift =
(Σ|x*ᵢ−seedBest[i]|)/7/mean(seedBest)×100 as a diagnostic signal measuring
aggregate adaptive-pass departure from the fixed-pass seed.
(19) Slider Functional Taxonomy — the seven management stance parameters are
classified into five functional categories (capacity: budget, schedule;
certainty: scope; process: scope reduction, rework; behavioral: risk tolerance;
other: user confidence), exposed in reports and counter-intuition warnings to
guide practitioners toward the correct organizational levers.
(20) Three-Level PSD Stabilization — three independent epsilon values at
three computational contexts: 1×10⁻⁶ for coupling signal z-score
standardization, 1×10⁻³ Cholesky pre-jitter (covers Tightly Coupled preset's
1.5× off-diagonal scaling), and 1×10⁻⁹ internal Cholesky algorithm floor;
each calibrated specifically for its context rather than using a single
universal value.

The result is context-aware estimation that adapts to both
organizational risk characteristics and documented project history,
grounded throughout in probabilistic and information-theoretic
foundations.

---

## REFERENCES

Chapman, C., & Ward, S. (2003). Transforming project risk management into
project uncertainty management. *International Journal of Project
Management*, 21(2), 97–105.

Chapman, C., & Ward, S. (2003). *Project Risk Management: Processes,
Techniques and Insights* (2nd ed.). Wiley.

Flyvbjerg, B. (2008). Curbing optimism bias and strategic
misrepresentation in planning: Reference class forecasting in practice.
*European Planning Studies*, 16(1), 3–21.

Flyvbjerg, B., Holm, M. S., & Buhl, S. (2002). Underestimating costs in
public works projects: Error or lie? *Journal of the American Planning
Association*, 68(3), 279–295.

Flyvbjerg, B., & Gardner, D. (2023). *How Big Things Get Done*. Crown.

Gelman, A., Carlin, J. B., Stern, H. S., Dunson, D. B., Vehtari, A., &
Rubin, D. B. (2013). *Bayesian Data Analysis* (3rd ed.). CRC Press.

Golenko-Ginzburg, D. (1988). On the distribution of activity time in
PERT. *Journal of the Operational Research Society*, 39(8), 767–771.

Howard, R. A. (1968). The foundations of decision analysis. *IEEE
Transactions on Systems Science and Cybernetics*, 4(3), 211–219.

Howard, R. A., & Matheson, J. E. (1984). Influence diagrams. In R. A.
Howard & J. E. Matheson (Eds.), *Readings on the Principles and
Applications of Decision Analysis* (Vol. 1, pp. 721–762). Strategic
Decisions Group.

Hubbard, D. W. (2014). *How to Measure Anything: Finding the Value of
Intangibles in Business* (3rd ed.). Wiley.

Hubbard, D. W., Budzier, A., & Bang Leed, S. (2024). *How to Measure
Anything in Project Management*. Wiley.

Kahneman, D., & Lovallo, D. (2003). Delusions of success: How optimism
undermines executives' decisions. *Harvard Business Review*, 81(7), 56–63.

Kahneman, D., & Tversky, A. (1979). Prospect theory: An analysis of
decision under risk. *Econometrica*, 47(2), 263–291.

Kullback, S., & Leibler, R. A. (1951). On information and sufficiency.
*Annals of Mathematical Statistics*, 22(1), 79–86.

Malcolm, D. G., Roseboom, J. H., Clark, C. E., & Fazar, W. (1959).
Application of a technique for research and development program
evaluation. *Operations Research*, 7(5), 646–669.

McKay, M. D., Beckman, R. J., & Conover, W. J. (1979). A comparison of
three methods for selecting values of input variables in the analysis of
output from a computer code. *Technometrics*, 21(2), 239–245.

Powell, M. J. D. (1994). A direct search optimization method that models
the objective and constraint functions by linear interpolation. In S.
Gomez & J.-P. Hennart (Eds.), *Advances in Optimization and Numerical
Analysis* (pp. 51–67). Kluwer Academic.

Project Management Institute. (2017). *A Guide to the Project Management
Body of Knowledge (PMBOK Guide)* (6th ed.). PMI.

Project Management Institute. (2021). *A Guide to the Project Management
Body of Knowledge (PMBOK Guide)* (7th ed.). PMI.

Project Management Institute. (2009). *Practice Standard for Project Risk
Management*. PMI.

Roberts, G. O., Gelman, A., & Gilks, W. R. (1997). Weak convergence and
optimal scaling of random walk Metropolis algorithms. *Annals of Applied
Probability*, 7(1), 110–120.

Silverman, B. W. (1986). *Density Estimation for Statistics and Data
Analysis*. Chapman and Hall.

Spetzler, C. S., & Staël von Holstein, C.-A. S. (1975). Probability
encoding in decision analysis. *Management Science*, 22(3), 340–358.

Washington State Department of Transportation. (2022). *Project Risk
Analysis Model (PRAM) User's Guide*. WSDOT.

---

## INVENTOR DECLARATION

I hereby declare that:
- I believe I am the original inventor of the subject matter claimed
  in this application.
- I have reviewed and understand the contents of this specification.
- I acknowledge the duty to disclose information material to
  patentability.

**Inventor:** Abel J. Stephen
**Date:** March 2, 2026
**Application:** ProjectCare / SACO Framework
**Organization:** iCareNOW.io

---

*This provisional patent application was prepared to establish a priority
date. A non-provisional application with formally drafted claims should
be filed within 12 months of this provisional filing date to claim
priority benefit under 35 U.S.C. § 119(e).*
