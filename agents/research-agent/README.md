# Codebase Research Agent

A specialized research agent powered by Claude API that reads, traces, and explains the ProjectCare codebase — mapping call chains, data flow, and architectural relationships across `.gs` and `.html` source files.

## What This Agent Does

**Call Chain Tracing**: Follow a function from entry point to final output across multiple files
**Data Flow Mapping**: Track how a variable (e.g., `scaledSliders`) is created, mutated, and consumed
**Mode Comparison**: Compare two code paths side-by-side (e.g., general vs. conservative optimization)
**Bug Investigation**: Given a symptom, trace backward to find the root cause
**Architecture Overview**: Produce a high-level component map with connection points

## When To Use This Agent

Use the research agent when you need to answer questions like:

- "How does `optimizeSliders` differ when `adaptive=true` vs `adaptive=false`?"
- "Where does `scaledSliders` come from and where does it go?"
- "What calls `step7_output` and what does it return?"
- "Why would all slider values be zero after optimization?"
- "Which files touch the target probability (`τ`) slider value?"

## Features

- Reads multiple `.gs` and `.html` files in a single session
- Produces structured call-chain diagrams (indented call trees)
- Generates side-by-side comparison tables for different code modes
- Documents variable origins, mutations, and consumers
- Flags assumptions, guard clauses, and edge case handling
- References specific file paths and line numbers throughout

## Setup

### 1. Install Dependencies

```bash
cd agents/research-agent
pip install -r requirements.txt
```

### 2. Set API Key

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

## Usage

### Basic Usage

Research a specific question:
```bash
python agents/research-agent/research-agent.py \
  --question "How do general and conservative optimization differ?" \
  core/optimization/optimizer.gs
```

Trace a function across multiple files:
```bash
python agents/research-agent/research-agent.py \
  --question "Trace how scaledSliders flows from optimizer to the UI" \
  core/optimization/optimizer.gs \
  core/main/main.gs \
  Plot.html
```

Compare two code paths:
```bash
python agents/research-agent/research-agent.py \
  --question "Compare adaptive=true vs adaptive=false in sacoObjective" \
  core/optimization/optimizer.gs
```

Investigate a bug:
```bash
python agents/research-agent/research-agent.py \
  --question "Why would all slider values show as zero after conservative optimization?" \
  core/optimization/optimizer.gs \
  core/main/main.gs \
  Plot.html
```

### Using Templates

The `config.json` defines named research templates. Pass `--template` to use one:

```bash
python agents/research-agent/research-agent.py \
  --template pipeline_trace \
  --entry-point optimizeSliders \
  core/optimization/optimizer.gs core/main/main.gs
```

Available templates: `pipeline_trace`, `compare_modes`, `data_flow`, `bug_investigation`, `architecture_overview`

## Understanding The Output

The agent returns a structured research report in markdown. Key sections:

### Call Chain

An indented tree of function calls with file references:
```
optimizeSliders (optimizer.gs:120)
  └─ step2_hypercubeLhs (optimizer.gs:180)
  └─ step5_refine (optimizer.gs:240)
       └─ sacoObjective (optimizer.gs:260)
            └─ reshapeDistribution (slider-adjustments.gs:45)
  └─ step7_output (optimizer.gs:520)
       └─ KLDivergence (kl-divergence.gs:12)
```

### Data Flow

Shows how a variable changes across files:
```
scaledSliders
  Created:   optimizer.gs:548  { ...sliders }  (0–1 range)
  Returned:  optimizer.gs:590  step7_output → optimizeSliders
  Consumed:  main.gs:297       response.optimize.scaledSliders
  Extracted: Plot.html:3820    extractSliderVals() auto-scales 0–1 → 0–100
  Applied:   Plot.html:3860    fillSlidersFromObject()
```

### Comparison Table

For mode comparisons:

| Aspect | General (adaptive=false) | Conservative (adaptive=true) |
|--------|--------------------------|-------------------------------|
| LHS Samples | 250 | 50 × probeLevel |
| COBYLA iters | 60 | 100 |
| Seed | None | From General result |
| Leash penalty | None | Exponential for drift > 8% |
| ProbeLevel 1 | N/A | Evaluates seed point only |

## Research Templates (config.json)

| Template | Purpose |
|----------|---------|
| `pipeline_trace` | Full call chain from entry to output |
| `compare_modes` | Side-by-side diff of two code paths |
| `data_flow` | Variable lifecycle across files |
| `bug_investigation` | Backward trace from symptom to cause |
| `architecture_overview` | High-level component map |

## VS Code Integration

Add to `.vscode/tasks.json`:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Research - Trace optimizer pipeline",
      "type": "shell",
      "command": "python",
      "args": [
        "agents/research-agent/research-agent.py",
        "--question", "Trace the full optimization pipeline from optimizeSliders to the final slider values shown in the UI",
        "core/optimization/optimizer.gs",
        "core/main/main.gs",
        "Plot.html"
      ],
      "presentation": { "reveal": "always", "panel": "new" }
    }
  ]
}
```

## Example Sessions

### Comparing Optimizer Modes

**Question**: "Is conservative optimization probe level 1 the same as general optimization? Do both use SACO?"

**Files read**: `optimizer.gs`

**Finding**: No — general uses `adaptive=false` (250 LHS samples, 60 COBYLA iterations, no seed), conservative uses `adaptive=true` (50×probeLevel samples, 100 iterations, seeded from general result, exponential leash penalty). ProbeLevel=1 conservative evaluates only the seed point.

---

### Tracing Slider Values After Optimization

**Question**: "Why would all slider values show as zero after conservative optimization?"

**Files read**: `optimizer.gs`, `main.gs`, `Plot.html`

**Finding**: `step7_output` contains a revert guard: if `finalProb < p0 - 0.0001` (`lift < 0`), all sliders are zeroed and baseline is restored. The adjP formula `p * (1 + scope*0.3)` was **increasing** P (making the distribution wider), causing `lift < 0` for all non-zero slider combinations — triggering the guard every time.

---

## Maintaining The Agent

### After a New Feature Is Added
```bash
# Update config.json components with new files
# Re-run a pipeline_trace to update call chain docs
python agents/research-agent/research-agent.py \
  --template pipeline_trace \
  --entry-point newFeatureEntry \
  core/new-feature/new-file.gs
```

### After a Bug Is Fixed
```bash
# Document the investigation in RULES.md
# Keep the symptom → root cause mapping for future reference
```

## Limitations

- Reads static source files — cannot execute code
- Call chains are inferred from reading, not runtime profiling
- Dynamic dispatch (e.g., `window[fnName]()`) may not be traceable
- Large files (> 2000 lines) may require specifying a line range

## Last Updated
March 1, 2026
