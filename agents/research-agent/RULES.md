# Research Rules for ProjectCare Codebase

These rules govern how the research agent reads, traces, and reports on the ProjectCare source code.

---

## Core Research Principles

### 1. Always Read Before Asserting
- Read the actual source file before making claims about what a function does
- Never guess at variable names, parameter order, or return values — verify them
- If a function is referenced but its file isn't loaded, say so explicitly

### 2. Cite File and Line Number
- Every function call or variable reference in a report must include `filename.gs:line`
- Example: `step7_output (optimizer.gs:520)` not just "step7_output"
- Use the format: `functionName (file.gs:NNN)`

### 3. Distinguish Code Paths Clearly
When comparing two modes (e.g., `adaptive=true` vs `adaptive=false`):
- Show the exact conditional that branches them
- List what is different: inputs, logic, outputs, guards
- Note what is the SAME — shared steps that run in both paths

### 4. Trace Guards and Revert Logic
The ProjectCare has multiple safety guards that reset or zero outputs:
- `step7_output` revert guard: zeros sliders if `lift < 0`
- KL divergence threshold: reverts if `KL > 0.08`
- Moment validation: rejects reshaped distributions outside bounds
- **Always** check guard conditions when tracing why output is unexpectedly zero/baseline

### 5. Map Variable Lifetimes
For any variable of interest, document:
- **Created**: where and in what form (e.g., `{key: 0–1 float}`)
- **Mutated**: any transformations applied
- **Consumed**: every callsite that reads it
- **Range**: numeric range at each stage (e.g., 0–1 vs 0–100)

---

## ProjectCare Architecture Rules

### 6. Optimizer Modes
Two optimizer modes exist in `core/optimization/optimizer.gs`:

| Mode | Parameter | Samples | Iterations | Seed |
|------|-----------|---------|------------|------|
| General | `adaptive=false` | 250 LHS | 60 COBYLA | None |
| Conservative | `adaptive=true` | 50×probeLevel | 100 COBYLA | General result |

- ProbeLevel 1 conservative = evaluates seed point only (degenerate mode)
- ProbeLevel 2–7 = 100–350 additional LHS samples around seed
- Both modes call the same `sacoObjective` function
- Both use `step7_output` for final distribution computation

### 7. Slider Value Domains
Slider values travel through several domain conversions:
- **UI DOM** (`s_budget` input): 0–100
- **`slidersUi` object** (normalized by `normalizeSlidersToFloat`): 0–1
- **`inputSliders` object** (raw from DOM): 0–100
- **Optimizer `x` array**: 0–1 (COBYLA works in unit cube)
- **`scaledSliders`** (returned by `step7_output`): copy of `x` → 0–1
- **`extractSliderVals` in Plot.html**: auto-scales 0–1 → 0–100 if `val > 0 && val < 1`

**Bug-prone area**: Double-division occurs if `slidersUi` (0–1) is passed where `inputSliders` (0–100) is expected, or vice versa.

### 8. adjO/adjM/adjP Formula Convention
The `sacoObjective` and `step7_output` functions adjust O/M/P to model the effect of slider settings:
- **Increasing P** (pessimistic) makes the distribution WIDER → P(finish ≤ τ) DECREASES → `lift < 0` → BAD
- **Decreasing P** makes the distribution NARROWER → P(finish ≤ τ) INCREASES → `lift > 0` → GOOD
- Formula must use factors `(1 - coefficient * slider)` for P to produce improvement
- The `lift < 0` revert guard in `step7_output` will zero ALL sliders if adjP increases P

### 9. KDE Smoothing
Monte Carlo smoothing (`core/baseline/monte-carlo-smoothed.gs`) uses:
- Gaussian kernel with bandwidth `h = range / 63.3`
- Bandwidth must be > 0; check for degenerate O = P case
- Output is a smoothed PDF array, not raw histogram

### 10. Copula Matrix
The 7×7 `BASE_R` correlation matrix in `core/reshaping/copula-utils.gs`:
- Must be positive semi-definite (all eigenvalues ≥ 0)
- Derived from PMBOK slider dependency assumptions
- Slider order: `[budgetFlexibility, scheduleFlexibility, scopeCertainty, scopeReductionAllowance, reworkPercentage, riskTolerance, userConfidence]`

---

## Report Structure Rules

### 11. Always Include a TL;DR
Every research report must start with a 2–4 sentence summary answering the question directly, before any detail.

### 12. Structure Complex Reports
For questions involving multiple files or modes, use these sections:
1. **TL;DR** — direct answer
2. **Call Chain** — indented call tree with file:line citations
3. **Data Flow** — variable lifecycle table
4. **Key Differences** — comparison table if comparing modes
5. **Edge Cases & Guards** — guard conditions that can silently change output
6. **Implications** — what the findings mean for debugging / correctness

### 13. Flag Undocumented Assumptions
When the code makes an assumption that isn't documented (e.g., "P is always > M"), flag it:
> **Assumption**: `sacoObjective` assumes `O < M < P`; no validation guard exists — degenerate inputs will produce `NaN`.

### 14. Do Not Suggest Changes
The research agent's job is to **describe**, not **prescribe**. Separate any fix suggestions into a clearly labeled "Recommendations" section at the end, not inline with findings.

---

## Known Codebase Patterns

### Pattern: `WS()` global state
Many functions use `WS()` to access a shared workspace object. Data persists between calls on `WS()`.

### Pattern: Pending state variables
`_zoomEnabled`, `_sZoomEnabled` store pre-initialization state for controls that don't exist yet. Check for these when tracing zoom/interaction logic.

### Pattern: `window._draw*` canvas functions
Triangle, Beta-PERT, and other simple distributions use raw Canvas 2D API via `window._drawTriPlot`, `window._drawPertPlot`, etc. — not Chart.js. Chart.js plugins do NOT apply to these.

### Pattern: `linkedCrosshairPlugin`
A Chart.js plugin registered per-chart (not globally). Must appear in each chart's `plugins: [...]` array. If a chart is missing it, the crosshair won't show.

---

## Last Updated
March 1, 2026
