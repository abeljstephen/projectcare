# Patent Protection Agent

Scans all code and user-facing content for disclosures that could jeopardize
the SACO provisional patent (Abel J. Stephen, iCareNOW.io, filed 2026-03-02).

## Usage

```bash
# Full scan — terminal report
python3 agents/patent-protect-agent/patent-agent.py

# Minimum severity filter
python3 agents/patent-protect-agent/patent-agent.py --min-sev HIGH

# JSON output (for scripting)
python3 agents/patent-protect-agent/patent-agent.py --json
```

## What It Checks

| ID | Check | Risk |
|----|-------|------|
| PAT-001 | Exact claimed formula constants in any public file | CRITICAL |
| PAT-002 | Full SACO implementation in browser-executable WordPress JS | HIGH |
| PAT-003 | BASE_R correlation matrix values in public code | HIGH |
| PAT-004 | Algorithm-level technical detail in user-visible tooltips | HIGH |
| PAT-005 | SACO / "Shape-Adaptive Copula Optimization" without "Patent Pending" notice | MEDIUM |
| PAT-006 | Inline code comments disclosing claimed mechanisms in public browser JS | MEDIUM |
| PAT-007 | README / documentation describing novel internals | LOW |
| PAT-008 | Git repository public visibility | INFO |

## Risk Categories Explained

**PAT-001 (CRITICAL):** The specific constant combinations in Claims 2–5
(`0.3 + 0.4 × coupling`, `0.8 - 0.5 × lin`, `exp(-KL)`, BASE_R row values)
appearing verbatim in any publicly accessible file gives a competitor the
exact implementation parameters to reproduce the claimed method.

**PAT-002 (HIGH):** The WordPress plugin engine JS files are served to browsers.
Any visitor can View Source and see the full Gaussian copula, LHS+COBYLA optimizer,
and Beta refit implementation. Three strategic options:
1. Move computation to a private server-side API (recommended long-term)
2. Run a JS obfuscator in the build pipeline
3. Accept exposure and rely on the patent for protection

**PAT-003 (HIGH):** The BASE_R correlation matrix is specifically claimed (Claim 5).
Its values in browser JS give competitors the calibration data to reproduce Claim 5.

**PAT-004 (HIGH):** Tooltips describing "KL divergence constraint", "Latin Hypercube
Sampling", "COBYLA", and "Gaussian copula" tell any user exactly which techniques
are used — enabling a skilled engineer to reconstruct the method. Replace with
functional descriptions of user benefit only.

**PAT-005 (MEDIUM):** Under 35 U.S.C. § 287, marking products "Patent Pending"
establishes constructive notice to potential infringers and supports damages
claims from the date of notice.

## Invocation phrase (for Claude Code)

> "run patent-agent on ProjectCare"
> "check patent protection risks"
> "run patent scan"
