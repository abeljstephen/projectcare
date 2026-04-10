# INVENTION DISCLOSURE
## Probabilistic Critical Path Engine with SACO-Integrated Stochastic Network Scheduling

**Inventor:** Abel J. Stephen
**Organization:** iCareNOW.io
**Date of Original Disclosure:** March 27, 2026
**Date of Amendment:** April 9, 2026
**Related Application:** SACO Provisional Patent Application (filed March 2, 2026;
  amended April 9, 2026 — Claims 16–21, Sections VII-D, X-A, X-B)
**Disclosure Type:** New Subject Matter — Intended for Non-Provisional Filing and/or Continuation-in-Part

---

## PURPOSE OF THIS DOCUMENT

This invention disclosure captures four novel technical contributions developed
as extensions to the SACO system (Shape-Adaptive Copula Optimization, provisional
filed March 2, 2026). These contributions relate to the integration of SACO's
probabilistic output with Critical Path Method (CPM) network scheduling, and to
new analytical techniques for stochastic schedule intelligence. They are not
covered by the provisional application and are documented here to establish the
date of conception and reduction to practice.

These contributions are intended for inclusion as additional independent or
dependent claims in the non-provisional SACO patent filing (due by March 2, 2027),
or as a separate continuation-in-part application if the non-provisional scope
does not accommodate them.

---

## BACKGROUND

### Limitations of Standard CPM

Critical Path Method (CPM) is the dominant technique for project network scheduling.
Given a set of tasks with durations and precedence relationships, CPM computes the
longest path through the dependency network (the critical path), the earliest and
latest start/finish dates for each task, and the float (slack) available before
a task delays the project end.

**Critical limitation 1 — Point estimate input:** Standard CPM requires a single
deterministic duration per task. This discards the probabilistic information
embedded in PERT three-point estimates and ignores the context-adjusted probability
distributions produced by SACO. A project plan where every task uses its P50
duration and a plan where every task uses its P90 duration have the same critical
path structure under standard CPM — despite carrying radically different schedule
risk profiles.

**Critical limitation 2 — Independence assumption:** Standard Monte Carlo
simulation of project networks samples each task's duration independently.
This assumption ignores the systematic correlations between tasks performed by
the same team under the same organizational conditions. If a team is
underperforming systemically (resources stretched, scope unclear, morale low),
all tasks in the network tend to overrun together. Independent sampling
underestimates the probability of total project overrun and overestimates the
risk-reduction benefit of parallel paths.

**Critical limitation 3 — Merge point bias (Fenton-Birnbaum effect):** When
multiple dependency paths converge at a node, the task's earliest start is the
maximum of all incoming earliest finish values. Because
E[max(X₁, X₂, ..., Xₙ)] > max(E[X₁], E[X₂], ..., E[Xₙ])
for independent non-degenerate random variables, deterministic CPM
systematically underestimates project duration at every convergence node.
This bias compounds across the network: a project with four convergence nodes
may have its expected duration underestimated by 10–25% relative to stochastic
simulation. No standard CPM tool warns the practitioner of this effect.

**Critical limitation 4 — Static float reporting:** Standard CPM reports float
as a static value. It does not compute the float consumption threshold at which
a non-critical task becomes critical — the tipping point beyond which using
available float shifts the critical path and increases project duration. This
information is directly actionable but absent from all standard CPM outputs.

**Critical limitation 5 — No network-level correlation modeling:** Standard
Monte Carlo schedule simulation (e.g., @RISK for Primavera, Oracle Crystal Ball)
samples task durations from independent distributions. While some tools allow
manual correlation specification between individual task pairs, none apply a
systematic correlation structure derived from organizational and management
theory. The SACO framework's Gaussian copula, which models management stance
correlations for single-task estimation, has not previously been extended to
model inter-task duration correlations in a project network.

No prior system has addressed all five limitations in a unified, integrated
computational pipeline.

---

## NOVEL CONTRIBUTIONS

### Contribution 1: SACO-to-CPM Integrated Probabilistic Scheduling Pipeline

**What it is:**
A computer-implemented pipeline that uses the probability distributions produced
by SACO (Shape-Adaptive Copula Optimization) as the duration inputs to both
deterministic and stochastic Critical Path Method computation, replacing the
single point-estimate input of standard CPM with context-adjusted probability
distributions.

**How it works:**
1. SACO runs independently on each task in a project network, producing for
   each task three distinct probability distributions: the PERT baseline
   distribution, the management-stance-adjusted distribution, and the
   SACO-optimized distribution.

2. The practitioner selects a target percentile (default P80) to extract a
   single duration value per task from the SACO-optimized distribution. This
   value — informed by the full copula-adjusted probabilistic context of each
   task — serves as the duration input to deterministic CPM.

3. For stochastic CPM, the full SACO-optimized CDF per task is retained. The
   stochastic engine samples from each task's CDF by inverting the CDF at a
   uniform random variate U ~ Uniform(0,1), producing a duration sample that
   respects the full shape of the SACO-optimized distribution including its
   asymmetry, tail weight, and context-adjusted percentile structure.

4. The deterministic CPM produces the schedule baseline. The stochastic CPM
   produces the criticality index, schedule sensitivity index, and project
   duration distribution as described in Contributions 2, 3, and 4.

**Why it is novel:**
No prior system uses copula-based, management-stance-conditioned probability
distributions as the duration input to CPM. Prior systems either use point
estimates (deterministic CPM) or independent parametric distributions
(Monte Carlo CPM). The SACO-to-CPM pipeline is the first to condition each
task's duration distribution on the practitioner's management stance before
computing the network schedule, producing a schedule that is coherent with
the same theoretical framework used for single-task estimation.

**Specific novelty over prior art:**
- Over standard deterministic CPM: introduces probabilistic, context-aware
  durations in place of point estimates.
- Over @RISK/Crystal Ball Monte Carlo CPM: the duration distributions are not
  independently fitted parametric distributions but SACO-optimized distributions
  conditioned on management stance decision nodes.
- Over PERT network analysis: PERT network statistics (sum of critical path
  means, root-sum-of-squares of variances) assume task independence and normal
  marginals. The SACO-to-CPM pipeline uses non-normal, asymmetric, Beta-refitted
  distributions and the inter-task correlation structure of Contribution 2.

---

### Contribution 2: Inter-Task Gaussian Copula Correlation in Stochastic Network Scheduling

**What it is:**
A computer-implemented method for modeling systematic correlations between
task duration outcomes in a project network using a Gaussian copula, applied
during Monte Carlo stochastic CPM simulation, where the correlation structure
is derived from organizational and management theory rather than historical
project data.

**How it works:**

The system constructs a task-level n×n correlation matrix R from six
similarity signals. For each task pair (i, j), the pairwise correlation
ρᵢⱼ is computed as:

    s = (wD×sD + wG×sG + wC×sC + wM×sM + wR×sR + wP×sP) / wTotal
    ρᵢⱼ = min(ρMax, (ρMin + (ρMax − ρMin) × s) × mSlider)

where ρMin = 0.05, ρMax = 0.85, and the six signals are:

**Signal sD — Risk Driver Cosine Similarity (weight wD = 0.45 when present):**
Each task may carry a riskSignals array of named risk drivers, each
optionally with a severity weight. The similarity between two tasks'
risk driver vectors is computed as weighted cosine similarity:
    sD = (Σₖ viₖ × vjₖ) / (‖vi‖ × ‖vj‖)
where viₖ is the severity weight of driver k in task i (1 if unweighted).
Tasks sharing risk drivers (e.g., "vendor-dependency", "regulatory-
approval") are assigned high correlation regardless of their position
in the network. When no task has riskSignals, wD = 0.

**Signal sG — Graph Distance Similarity (weight wG = 0.20, or 0.15 with phase):**
    sG = exp(−0.5 × d)
where d is the shortest directed distance between tasks i and j in
the dependency graph (BFS from all-pairs precomputation). Adjacent
tasks (d=1) receive sG ≈ 0.61; tasks four hops apart receive sG ≈ 0.14.

**Signal sC — Critical Path Co-Membership (weight wC = 0.15):**
    sC = 1.0  if both tasks are on the deterministic critical path
    sC = 0.5  if exactly one task is critical
    sC = 0.0  if neither task is critical
Tasks on the critical path together experience duration pressure from
the same path-driven systemic forces.

**Signal sM — Merge Ancestor Overlap (weight wM = 0.10):**
For each convergence node in the network, the system precomputes the
set of all ancestor tasks. The merge ancestor overlap similarity
between tasks i and j is:
    sM = shared_merge_ancestors(i, j) / total_merge_ancestors(i, j)
Tasks that share many common ancestors feeding the same convergence
points are structurally coupled and experience correlated schedule
pressure at those points.

**Signal sR — Shared Resource (weight wR = 0.10):**
    sR = 1.0 if task i and task j have the same resource field value
    sR = 0.0 otherwise
Resource sharing is the most direct form of task coupling: the same
team or person working on two tasks creates direct bandwidth competition
and correlated performance variation.

**Signal sP — Shared Phase (weight wP = 0.05):**
    sP = 1.0 if task i and task j have the same phase field value
    sP = 0.0 otherwise
Tasks in the same project phase (e.g., "Design", "Build", "Test")
share organizational conditions, approval gates, and management attention.

**Slider Multiplier mSlider:**
The project-level SACO management stance vector modulates all pairwise
correlations:
    mSlider = exp(0.35×RW − 0.20×SC − 0.10×SF − 0.05×BF − 0.10×UC)
where RW = reworkPercentage/50, SC = scopeCertainty/100,
SF = scheduleFlexibility/100, BF = budgetFlexibility/100,
UC = userConfidence/100 (all normalized to [0,1]).
High rework (RW) amplifies inter-task correlations (shared quality
problems compound across tasks); high scope certainty (SC) suppresses
correlations (well-defined tasks have more independent outcomes).

**Higham Nearest PSD Repair:**
After constructing R from the six signals, the matrix may not be
positive semi-definite due to the elementwise construction. The system
applies Higham's (2002) alternating projections algorithm to find the
nearest valid correlation matrix:
    Iterate: project onto PSD cone (eigenvalue floor at 0) →
             project back to unit-diagonal correlation matrix
    Until: Frobenius norm of successive iterates < 1×10⁻¹²
    Maximum iterations: 100

**Cholesky Decomposition with Safety Shift:**
The repaired matrix is Cholesky-factored with ε = 1×10⁻⁹ safety shift:
    L = chol(R_repaired + ε·I)
    such that L × Lᵀ ≈ R_repaired

**Correlated duration sampling:**
For each Monte Carlo iteration, the system generates correlated uniform
variates via the probability integral transform:
    z ~ N(0, I_n)              [independent standard normals]
    z_corr = L × z             [Cholesky-correlated]
    u_i = Φ(z_corr_i)         [transform to U(0,1) via standard normal CDF]
    d_i = CDF_SACO_i⁻¹(u_i)  [invert task i's SACO-optimized CDF]

The resulting task durations dᵢ have marginal distributions equal to
each task's SACO-optimized distribution and pairwise Gaussian copula
correlations matching the constructed R matrix.

1. Tasks in disconnected components of the project network are assigned
   zero correlation (ρᵢⱼ = 0 if componentOf(i) ≠ componentOf(j)).

**Why it is novel:**
Standard Monte Carlo schedule simulation assumes task duration independence.
Systems that allow manual correlation specification (e.g., @RISK for Primavera)
require the practitioner to specify individual pairwise correlations without
theoretical guidance. The present method derives the inter-task correlation
structure from six theoretically grounded signals — risk driver semantic
similarity, graph topology, critical path membership, merge ancestor structure,
resource sharing, and phase cohesion — combined with a project-level SACO
slider multiplier, producing a correlation structure that is (a) computable
without any historical data or manual specification, (b) grounded in project
management theory, and (c) consistent with the same management stance
framework governing single-task estimation.

This is the first application of a multi-signal, topology-aware Gaussian copula
to inter-task duration correlation in stochastic project network scheduling.

---

### Contribution 3: Critical Path Tipping Point Analysis

**What it is:**
A computer-implemented method for computing, for each non-critical task in a
project network, the precise float consumption threshold — the amount of float
usage that causes that task to become critical, shifting the critical path and
increasing the expected project end date — together with the resulting project
duration increase at each tipping point.

**How it works:**
1. After the deterministic CPM forward and backward passes are complete, each
   non-critical task T_i has total float F_i = LateFinish_i - EarlyFinish_i > 0.

2. For each non-critical task T_i, the tipping point Θ_i is computed as:

       Θ_i = F_i - (F_critical_path_successor - 0)

   where F_critical_path_successor is the minimum float on any path from T_i
   to the project sink node that does not currently pass through the critical
   path. Θ_i is the amount of float T_i can consume before a non-critical path
   through T_i achieves zero total float, making it a new critical path.

3. For each task T_i, the tipping point output includes:
   (a) Θ_i: float consumption threshold in project duration units;
   (b) ΔDuration_i: the expected increase in project end date if T_i uses
       exactly Θ_i units of float (the path now shares critical status);
   (c) The identities of the tasks whose float is affected when T_i
       reaches its tipping point;
   (d) A severity classification: HIGH (Θ_i < 10% of project duration),
       MEDIUM (10–25%), LOW (>25%).

4. Tipping point analysis is presented as a ranked table, sorted by Θ_i
   ascending, enabling the practitioner to identify the most fragile
   non-critical tasks first.

**Why it is novel:**
Standard CPM reports float as a static value without communicating the
dynamic threshold at which float consumption changes the project's critical
path structure. No prior CPM system, including MS Project, Primavera P6,
or Monte Carlo CPM tools, automatically computes or reports the float
consumption threshold at which each non-critical task transitions to
critical status. This computation is analytically tractable from the CPM
backward pass data and requires no additional input from the practitioner.

---

### Contribution 4: Integrated Probabilistic Schedule Intelligence System

**What it is:**
A computer-implemented system combining SACO single-task probabilistic estimation,
SACO-to-CPM pipeline integration (Contribution 1), inter-task Gaussian copula
correlation (Contribution 2), and critical path tipping point analysis
(Contribution 3) into a unified schedule intelligence platform, producing the
following composite outputs not available in any prior single system:

(a) **Criticality Index per task:** The fraction of Monte Carlo iterations in
    which each task lies on the critical path, quantifying each task's
    probability of determining the project end date. Computed over N iterations
    of stochastic CPM using SACO-optimized, copula-correlated duration samples.

(b) **Schedule Sensitivity Index (SSI) per task:**
        SSI_i = CriticalityIndex_i × (σ_task_i / σ_project)
    Ranking tasks by their combined probability of being critical and their
    contribution to project duration variance. The SSI tornado chart is the
    primary risk mitigation guidance output.

(c) **Merge Point Bias Quantification:** For each convergence node in the
    project network, the system computes the difference between the
    deterministic CPM earliest finish at that node and the expected earliest
    finish from stochastic simulation:
        MergePointBias_node = E_stochastic[EarlyFinish_node] - EarlyFinish_CPM_node
    Reporting this bias quantifies the systematic optimism of the deterministic
    schedule and motivates the use of stochastic analysis.

(d) **Schedule Health Score:** A composite 0–100 score computed as:

        raw = 0.30×NCP + 0.20×CD + 0.15×GD + 0.15×CIS + 0.20×NEG
        SHS = 100 × (1 − raw),  clamped to [0, 100], rounded to integer
        Grade: A (≥80), B (≥65), C (≥50), D (≥35), F (<35)

    where:
        NCP  = fraction of tasks with total float < 10% of project duration
               [weight 0.30 — dominant factor: near-critical congestion]
        CD   = number of convergence nodes / total node count
               [weight 0.20 — network bottleneck density]
        GD   = graph density (actual edges / maximum possible edges)
               [weight 0.15 — overall network complexity]
        CIS  = max(0, 1 − std(criticalityIndex) / 0.5)
               [weight 0.15 — criticality index spread; low spread means
               most tasks are equally critical, indicating systemic risk;
               max(0,...) clamps CIS at 0 when std(CI) > 0.5, preventing
               negative factor contributions in highly-spread schedules]
        NEG  = 1.0 if any task has negative total float, 0.0 otherwise
               [weight 0.20 — binary penalty for already-overdue schedules]

    **Implementation note on NEG vs. MPB_norm:** An earlier formulation
    of the SHS used a normalized merge-point-bias factor (MPB_norm) as the
    fifth component. Empirical validation showed that the binary negative-
    float flag (NEG) is a more actionable and discriminative signal: a
    schedule with any negative float is categorically in distress regardless
    of the magnitude of merge point bias, and merge point bias is already
    reported separately as output (c). NEG was substituted for MPB_norm in
    the implemented formula. The merge point bias remains a distinct output
    (see item (c) above) and continues to be disclosed as a novel contribution.

    This composite score provides a single interpretable metric for overall
    schedule risk, analogous to a credit score for project schedules.

(e) **Project Duration S-Curve:** The cumulative distribution function of
    project end date, computed from stochastic CPM iterations, expressed as
    P(project completes by date D) for a range of dates D. This is the
    network-level analog of the single-task SACO probability output.

(f) **Near-Criticality Index (NCI) per task:** The fraction of Monte Carlo
    iterations in which each task is "near-critical" — defined as lying on
    any path whose total float in that iteration is less than a specified
    threshold (default: 10% of that iteration's project duration). NCI
    extends the criticality index to capture tasks that are not on the
    critical path but are structurally close to it:
        NCI_i = count(iterations where float_i < threshold×duration) / N
    Tasks with high NCI but moderate CI represent hidden schedule risks:
    they are not critical in the modal scenario but become critical under
    even small adverse variations.

(g) **Top-K Critical Path Identities:** For each Monte Carlo iteration, the
    system records the identity of the critical path as a canonical string
    (ordered task IDs joined by "→"). After all iterations, the top-K most
    frequent critical path identities are returned with their relative
    frequencies:
        topCriticalPaths = [{path: "t1→t3→t5", frequency: 0.62}, ...]
    This output reveals whether the project has a dominant single critical
    path (high frequency of one path) or multiple competing critical paths
    (flat frequency distribution), a structurally important distinction
    that deterministic CPM cannot surface.

(h) **Merge Bottleneck per Convergence Node:** For each convergence node
    (in-degree > 1), the system tracks which predecessor was the latest
    to finish (the bottleneck) in each Monte Carlo iteration:
        mergeBottleneck[node] = { bottleneckTask: id, frequency: 0.71 }
    The most frequent bottleneck task at each convergence node is the
    single most actionable risk mitigation target: reducing its duration
    variability has the highest expected impact on schedule at that
    convergence point. This output has no equivalent in any prior CPM
    or Monte Carlo CPM system.

**Why it is novel:**
No prior system produces all eight of these outputs from a single integrated
pipeline that begins with management-stance-conditioned single-task estimation
(SACO), propagates that estimation through a multi-signal copula-correlated
stochastic network model, and produces schedule intelligence outputs at both
the task level (criticality index, NCI, SSI, tipping point) and the project
level (S-curve, health score, merge point bias, top-K critical paths, merge
bottlenecks). The eight outputs together constitute a probabilistic schedule
intelligence system with no prior art equivalent in the project management
software literature or patent record.

Of particular novelty: the Top-K critical path identity output (g) and the
Merge Bottleneck output (h) require tracking identity across Monte Carlo
iterations — a design choice that substantially increases output richness
at modest computational cost — and have no documented equivalent in any
published Monte Carlo CPM tool.

---

### Contribution 5: Risk Driver Semantic Similarity for Task Correlation

**What it is:**
A computer-implemented method for computing pairwise correlation
between project tasks based on semantic similarity of their named
risk drivers, using weighted cosine similarity of sparse risk driver
vectors, as one signal in a multi-signal inter-task correlation
matrix construction.

**How it works:**
1. Each task optionally carries a riskSignals array. Each element is
   either a string tag (e.g., "vendor-dependency") or an object
   {tag: string, severity: number ≥ 0}. Tags without explicit severity
   receive severity = 1.

2. For each task, a sparse risk driver vector v is constructed:
   v[tag] = severity, for all tags in the task's riskSignals array.

3. For each pair of tasks (i, j), cosine similarity is computed:
       sD = (Σₖ viₖ × vjₖ) / (√(Σₖ viₖ²) × √(Σₖ vjₖ²))
   where the sum is over all tag keys present in either vector.
   If either vector is empty, sD = 0.

4. sD contributes to the pairwise inter-task correlation with the
   highest weight in the system (wD = 0.45 when riskSignals are
   present) — exceeding all other signals — reflecting the principle
   that shared risk driver exposure is the strongest predictor of
   correlated duration outcomes.

**Why it is novel:**
No prior stochastic CPM system uses semantic similarity between
task-level risk driver labels as a basis for constructing inter-task
duration correlations. Prior correlation-aware systems require either
manual pairwise specification or a historical project database.
The present method:
- Requires only practitioner-accessible knowledge (which risks
  affect which tasks), not historical data
- Uses severity-weighted cosine similarity — a technique from
  natural language processing applied here to project risk
  characterization — to produce a principled, magnitude-aware
  correlation coefficient
- Automatically sets correlation to zero for tasks with no shared
  risk drivers, without requiring explicit zero-specification
- Scales with the practitioner's investment: more detailed risk
  tagging produces a more refined correlation structure, while
  minimal or absent tagging degrades gracefully to graph-topology-
  only correlation (no user intervention required)

The combination of risk driver cosine similarity as a first-class
input to Gaussian copula inter-task correlation is, to the inventors'
knowledge, without prior art in project scheduling software or
published research.

---

## PRIOR ART DISTINGUISHED

| Prior System | What It Does | What This Disclosure Adds |
|---|---|---|
| Standard CPM (MPP, Primavera P6) | Deterministic forward/backward pass, float, critical path | SACO-conditioned probabilistic duration inputs; tipping point analysis; SHS; NCI; merge bottleneck |
| @RISK for Primavera / Oracle Crystal Ball | Monte Carlo CPM with independent parametric distributions | SACO-conditioned distributions; 6-signal topology-aware inter-task copula; risk driver cosine similarity |
| PERT network analysis | Sum critical path means; root-sum-of-squares variances; assumes normal, independent | Non-normal SACO distributions; copula correlations; criticality index; SSI; NCI |
| Schedule Risk Analysis (SRA) tools | Criticality index, SSI via independent Monte Carlo | Copula-correlated sampling; NCI; top-K critical path identities; merge bottleneck per convergence node |
| @RISK manual correlation | Requires practitioner to specify each pairwise correlation manually | Automatic derivation from 6 signals: risk drivers, graph topology, critical path, merge ancestors, resource, phase |
| SACO provisional (March 2, 2026; amended April 2026) | Single-task probabilistic estimation; Claims 1–21 including Claim 6 multi-task convolution | Network scheduling, dependency graph, tipping point, 6-signal inter-task copula, SHS, NCI, top-K paths, merge bottleneck |

---

## REDUCTION TO PRACTICE

All contributions have been fully implemented as of April 9, 2026.

**Fully implemented (complete reduction to practice):**

- [x] SACO-to-CPM pipeline: percentile extraction and full CDF retention per task
- [x] Six-signal inter-task correlation matrix with Higham PSD repair and Cholesky
      factorization (implemented in both browser JS and Google Apps Script GAS)
- [x] Tipping point computation algorithm from CPM backward pass data
- [x] Schedule Health Score (SHS): five-factor formula with NCP/CD/GD/CIS/NEG
      weights calibrated to 0.30/0.20/0.15/0.15/0.20
- [x] Criticality index and SSI per task from N-iteration stochastic CPM
- [x] Near-Criticality Index (NCI) per task — fraction of iterations near-critical
- [x] Top-K critical path identities with iteration frequencies
- [x] Merge point bias per convergence node (stochastic vs. deterministic EF)
- [x] Merge bottleneck per convergence node (most frequent late predecessor)
- [x] S-curve (25-point CDF of project duration distribution)
- [x] riskSignals cosine similarity enrichment input and correlation weighting
- [x] resource and phase similarity enrichment inputs and correlation weighting
- [x] Slider multiplier mSlider threading from SACO context to inter-task R matrix
- [x] Tarjan's SCC cycle detection, Kahn's topological sort, BFS all-pairs distance,
      merge ancestor precomputation — all graph preprocessing algorithms
- [x] Disconnected component detection and zero-correlation enforcement

Implementation exists in:
- `engines/cpm-browser/` — browser-executable JS modules (graph.js, cpm-engine.js,
  stochastic-cpm.js, cpm-adapter.js)
- `api/core/saco-gas/cpm/` — Google Apps Script versions (same algorithms)
- The SACO engine (`api/core/saco-gas/`) is the upstream estimation component

---

## CLAIMS INTENDED FOR NON-PROVISIONAL FILING

**Proposed Claim A (Independent — SACO-to-CPM Pipeline):**
A computer-implemented method for probabilistic project network scheduling
comprising:
(a) applying Shape-Adaptive Copula Optimization (SACO) independently to each
    task in a project network to produce, for each task, a management-stance-
    conditioned probability distribution over task duration;
(b) extracting a deterministic duration per task from said distribution at a
    practitioner-specified target percentile for use in deterministic Critical
    Path Method computation;
(c) retaining the full SACO-optimized cumulative distribution function per task
    for use in stochastic Critical Path Method computation;
(d) executing stochastic Critical Path Method by sampling each task's duration
    from its SACO-optimized distribution via probability integral transform
    inversion over N iterations; and
(e) producing a project duration cumulative distribution function from said
    N-iteration stochastic Critical Path Method computation.

**Proposed Claim B (Dependent on Claim A — Inter-Task Copula):**
The method of Claim A, wherein step (d) further comprises grouping tasks by
shared organizational attribute into correlation clusters, and within each
cluster sampling task durations from a multivariate Gaussian copula whose
correlation coefficient is derived from the project-management-theoretic
correlation matrix of the SACO system, such that task durations within a
cluster exhibit the systematic correlations implied by shared management
conditions rather than being sampled independently.

**Proposed Claim C (Independent — Tipping Point Analysis):**
A computer-implemented method for critical path tipping point analysis
comprising:
(a) executing Critical Path Method on a project task network to produce total
    float values for each non-critical task;
(b) for each non-critical task T_i with total float F_i, computing the tipping
    point Θ_i as the minimum float consumption by T_i that causes any path
    through T_i to achieve zero total float, making said path simultaneously
    critical with the existing critical path;
(c) computing the project duration increase resulting from said path achieving
    simultaneous critical status; and
(d) reporting tipping points ranked by Θ_i ascending, together with the
    resulting project duration impact and the identities of tasks on the
    newly critical path.

**Proposed Claim D (Independent — Schedule Intelligence System):**
A computer-implemented system for probabilistic schedule intelligence comprising:
(a) a SACO estimation engine producing management-stance-conditioned duration
    distributions per task;
(b) a stochastic CPM engine sampling from said distributions using an inter-task
    Gaussian copula correlation structure derived from project management theory;
(c) a criticality index processor computing, for each task, the fraction of
    stochastic iterations in which the task lies on the critical path;
(d) a schedule sensitivity index processor computing SSI_i = CriticalityIndex_i
    × (σ_task_i / σ_project) for each task;
(e) a merge point bias processor computing, for each network convergence node,
    the difference between deterministic and stochastic expected earliest finish;
(f) a tipping point processor as described in Claim C; and
(g) a schedule health score processor computing a composite 0–100 score as:
        raw = 0.30×NCP + 0.20×CD + 0.15×GD + 0.15×CIS + 0.20×NEG
        SHS = 100 × (1 − raw)
    where NCP is the near-critical task fraction, CD is convergence density,
    GD is graph density, CIS is criticality index spread, and NEG is the
    binary negative-float penalty.

**Proposed Claim E (Independent — Multi-Signal Inter-Task Correlation Construction):**
A computer-implemented method for constructing an inter-task correlation
matrix for stochastic project network scheduling comprising:
(a) for each pair of tasks (i, j) in the project network, computing six
    similarity signals:
    (i)   risk driver cosine similarity sD between task risk signal vectors,
          where each risk signal vector is weighted by driver severity;
    (ii)  graph distance similarity sG = exp(−0.5 × d) where d is the
          shortest directed path length between tasks in the dependency graph;
    (iii) critical path co-membership sC ∈ {0, 0.5, 1.0};
    (iv)  merge ancestor overlap sM = shared convergence ancestors / total;
    (v)   shared resource indicator sR ∈ {0, 1}; and
    (vi)  shared phase indicator sP ∈ {0, 1};
(b) computing a weighted composite similarity:
        s = (wD×sD + wG×sG + wC×sC + wM×sM + wR×sR + wP×sP) / wTotal
    where weights are adapted based on which enrichment fields are present;
(c) modulating the raw correlation by a project-level SACO slider multiplier:
        mSlider = exp(0.35×rework − 0.20×scope − 0.10×schedule −
                      0.05×budget − 0.10×userConf)
    reflecting that high rework amplifies inter-task correlations while
    high scope certainty suppresses them; and
(d) assigning pairwise correlation
        ρᵢⱼ = min(ρMax, (ρMin + (ρMax − ρMin) × s) × mSlider)
    with ρMin = 0.05 and ρMax = 0.85.

**Proposed Claim F (Dependent on Claim E — Higham PSD Repair):**
The method of Claim E, further comprising, after constructing the
elementwise correlation matrix R, applying Higham's (2002) nearest
correlation matrix algorithm via alternating projections to find the
nearest positive semi-definite matrix to R:
(a) iteratively projecting onto the PSD cone by eigenvalue decomposition
    with negative eigenvalue flooring at zero; then
(b) projecting back to the unit-diagonal correlation matrix space;
    until the Frobenius norm of successive iterates falls below 1×10⁻¹²
    or a maximum of 100 iterations is reached;
thereby guaranteeing that the resulting matrix is a valid correlation
matrix suitable for Cholesky factorization, without requiring manual
construction of a PSD-safe matrix or ad hoc regularization.

**Proposed Claim G (Independent — Near-Criticality Index):**
A computer-implemented method for stochastic project schedule analysis
comprising:
(a) executing N Monte Carlo iterations of stochastic Critical Path Method,
    producing for each task and each iteration: a total float value and
    the project duration for that iteration;
(b) defining a per-iteration near-critical threshold as a fixed fraction of
    that iteration's project duration (default: 10%), such that the threshold
    adapts to the project duration realized in each iteration rather than
    using a fixed absolute threshold;
(c) computing, for each task, a Near-Criticality Index (NCI):
        NCI_i = count(iterations where totalFloat_i < 0.10 × duration_iter) / N;
    and
(d) reporting NCI alongside the criticality index CI and Schedule Sensitivity
    Index SSI, enabling distinction between:
    (i)  tasks with high CI and high NCI: dominant critical path members;
    (ii) tasks with moderate CI and high NCI: frequent near-critical tasks
         ("hidden schedule risks") that become critical under modest adverse
         variation but are absent from the deterministic critical path; and
    (iii) tasks with low CI and low NCI: genuinely non-critical tasks
    — a three-way classification not available from deterministic CPM or
    from CI alone.

**Proposed Claim H (Independent — Critical Path Identity Tracking and Merge Bottleneck):**
A computer-implemented method for stochastic project schedule intelligence
comprising, during N Monte Carlo iterations of stochastic CPM:
(a) for each iteration, identifying the set of tasks comprising the critical
    path and encoding said set as a canonical ordered identity string;
(b) accumulating a frequency count for each distinct critical path identity
    across all N iterations and returning the top-K most frequent paths with
    their empirical probabilities, thereby revealing whether the project has
    a dominant single critical path or competing paths with similar likelihood;
(c) for each convergence node (task with in-degree > 1), recording which
    predecessor task had the latest finish time in each iteration (the merge
    bottleneck); and
(d) reporting, for each convergence node, the most frequent merge bottleneck
    task and its frequency, identifying the single most actionable risk
    mitigation target at each convergence point in the network.

---

## CONFIDENTIALITY NOTE

This document is a confidential internal invention disclosure. It does not
constitute a public disclosure. All novel methods described herein remain
patent-pending subject matter under the SACO provisional application and are
intended for non-provisional patent protection. Do not distribute externally.

---

*Inventor signature: Abel J. Stephen*
*Original disclosure date: March 27, 2026*
*Amendment date: April 9, 2026 (Contributions 2 expanded, Contribution 5 added,*
*SHS formula corrected, Reduction to Practice updated, Claims E–H added)*
*iCareNOW.io*
