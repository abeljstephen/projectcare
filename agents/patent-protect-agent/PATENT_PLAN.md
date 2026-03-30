# ProjectCare — Patent Protection Plan

> Living document. Add new tasks by appending blocks in the same format.
> The patent-agent reads this file and runs all enabled checks in phase order.
> Patent: SACO Provisional Application — Abel J. Stephen, iCareNOW.io
> Filed: 2026-03-02. Status: Provisional (12-month window to non-provisional).

---

## Phase 1 — Formula & Constant Disclosure  (CRITICAL risk)

```yaml
id: PAT-001
title: Exact claimed formula literals in any file
phase: static
severity: CRITICAL
enabled: true
description: >
  Scan all source and content files for exact mathematical expressions that
  appear verbatim in Claims 1–7: the interpolation weight formula
  (0.3 + 0.4 × coupling), the variance adjustment (0.8 - 0.5 × lin),
  the KL objective P(τ)^(1+bb) × exp(-KL), and the BASE_R matrix row values.
  These exact constants + structure appearing in public-accessible files
  could enable a competitor to reproduce the claimed method without license.
pass_when: No claimed formula literals in any user-accessible or public file.
files: ["**/*.gs", "**/*.js", "**/*.html", "**/*.py", "**/*.md"]
```

---

## Phase 2 — Public Code Disclosure  (HIGH risk)

```yaml
id: PAT-002
title: Full algorithm implementation in browser-executable JS
phase: static
severity: HIGH
enabled: true
description: >
  The WordPress plugin engine files (copula.js, optimizer.js, saco.js,
  baseline.js) are served to browsers and readable by anyone via View Source.
  They contain the complete SACO implementation including Gaussian copula
  transformation, LHS+COBYLA optimization, KL divergence computation, and
  Beta refit — all core to Claims 1–9. This is the highest competitive
  exposure risk: a skilled engineer can reconstruct the method from these files.
pass_when: Engine JS files are either obfuscated, server-side only, or
  explicitly documented as licensed under patent-pending protection.
files: ["wordpress-plugin/pmc-estimator/assets/js/engine/*.js"]
```

```yaml
id: PAT-003
title: BASE_R correlation matrix values in deployed code
phase: static
severity: HIGH
enabled: true
description: >
  Claim 5 specifically claims the Gaussian copula correlation matrix derived
  from PMBOK knowledge area interdependency analysis, including negative
  correlations between rework and scope certainty, and positive correlations
  between risk tolerance and user confidence. The exact BASE_R values appearing
  in any publicly accessible file give competitors the core calibration data
  needed to reproduce Claim 5.
pass_when: BASE_R values are only in server-side GAS files, not in browser JS.
files: ["**/*.js", "**/*.gs"]
```

---

## Phase 3 — User-Facing Technical Disclosure  (HIGH risk)

```yaml
id: PAT-004
title: Algorithm-level detail in user-visible tooltip/help text
phase: static
severity: HIGH
enabled: true
description: >
  Plot.html data-body tooltip attributes and help text describe the SACO
  algorithm at implementation level (copula transformation, LHS, COBYLA,
  KL divergence, hybrid moment mapping). While describing what the product
  does is normal, describing HOW it works at the formula/implementation level
  in tooltips accessible to any user constitutes public disclosure that
  could assist a competitor or form the basis of a prior art challenge.
pass_when: Tooltips describe functional benefit only, not internal mechanism
  with enough detail to reproduce the method.
files: ["system-google-sheets-addon/Plot.html",
        "wordpress-plugin/pmc-estimator/templates/estimator.html",
        "wordpress-plugin/pmc-estimator/assets/js/app.js"]
```

---

## Phase 4 — Patent Notice  (MEDIUM risk)

```yaml
id: PAT-005
title: SACO / Shape-Adaptive Copula Optimization used without patent notice
phase: static
severity: MEDIUM
enabled: true
description: >
  Under U.S. patent law (35 U.S.C. § 287), marking products "Patent Pending"
  establishes constructive notice to potential infringers and supports damages
  from the date of actual notice. The name "SACO" and "Shape-Adaptive Copula
  Optimization" appear in the product UI and documentation without any
  "Patent Pending" notice. Adding patent notice to at least the product UI
  and primary README strengthens the patent holder's position.
pass_when: At least one user-visible location per deployed product surface
  (GAS add-on, WordPress plugin) carries "Patent Pending" notice alongside
  SACO branding.
files: ["system-google-sheets-addon/Plot.html",
        "wordpress-plugin/pmc-estimator/templates/estimator.html",
        "README.md", "**/*.md"]
```

---

## Phase 5 — Source Code Comment Disclosure  (MEDIUM risk)

```yaml
id: PAT-006
title: Inline code comments explaining novel algorithm internals
phase: static
severity: MEDIUM
enabled: true
description: >
  Source code files (.gs, .js, .py) contain inline comments that explain
  the copula transformation, LHS sampling, COBYLA objective, and KL
  divergence penalty at a level that clarifies the novel method. While
  patent rights are not lost by having commented source code, these
  comments represent competitive intelligence that a bad actor could use
  to design around the claims. Assess whether comments in public-accessible
  files describe claimed novelties.
pass_when: Comments in public-facing files describe purpose/intent only,
  not the novel mathematical mechanism.
files: ["**/*.gs", "**/*.js", "**/*.py"]
```

---

## Phase 6 — Documentation Disclosure  (LOW risk)

```yaml
id: PAT-007
title: README / documentation method disclosure
phase: static
severity: LOW
enabled: true
description: >
  README.md files and documentation describe the SACO method. Assess
  whether any README goes beyond product-level description into the
  internal algorithmic detail at a level that constitutes meaningful
  prior art disclosure or competitive intelligence.
pass_when: Documentation describes what the product does and its benefits,
  not how the novel algorithm works at implementation level.
files: ["**/*.md", "**/*.txt"]
```

---

## Phase 7 — Git Repository Exposure  (INFO)

```yaml
id: PAT-008
title: Repository visibility and git history exposure
phase: static
severity: INFO
enabled: true
description: >
  If the repository is public on GitHub, all code — including archive
  snapshots, development history, and experimental branches — is accessible
  to anyone. Git history shows algorithm evolution over time. This is an
  informational check: assess repo visibility and flag if public.
pass_when: Repository is private, or disclosure risk is accepted as informed
  business decision.
files: ["."]
```

---

## Template — Add New Patent Check

```yaml
id: PAT-XXX
title: Short descriptive title
phase: static
severity: CRITICAL  # CRITICAL | HIGH | MEDIUM | LOW | INFO
enabled: true
description: >
  What the check looks for and why it matters for patent protection.
pass_when: Condition that makes this check green.
files: ["relative/path/to/file.ext"]
```
