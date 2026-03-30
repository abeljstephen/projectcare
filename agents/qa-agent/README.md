# QA Orchestrator Agent

A senior QA agent that coordinates `math-agent`, `research-agent`, and its own built-in static
checks to produce a comprehensive, prioritised QA report for any ProjectCare component.

## What It Does

| Phase | What runs | API needed? |
|---|---|---|
| Static checks | Duplicate IDs, missing callbacks, slider key consistency, cache key completeness, console.log in GAS, missing error boundaries, broken event bindings | No |
| Math audit | Delegates to `math-agent` — PERT, Beta, KDE, copula, KL divergence, CDF monotonicity | Yes |
| Research analysis | Delegates to `research-agent` — pipeline integrity, cache key completeness, slider data flow, cross-file dependencies | Yes |
| Synthesis | Claude synthesises all findings into a single prioritised report with health score and action plan | Yes |

## Usage

```bash
cd agents/qa-agent

# Full QA on Google Sheets add-on (recommended)
python qa-agent.py --target google-sheets-addon --scope full

# Static checks only (fast, no API key needed)
python qa-agent.py --target google-sheets-addon --scope static

# Math audit only
python qa-agent.py --target google-sheets-addon --scope math

# Research / flow analysis only
python qa-agent.py --target google-sheets-addon --scope research

# WordPress plugin
python qa-agent.py --target wordpress-plugin --scope full
```

Reports are written to `agents/qa-agent/reports/YYYY-MM-DD-HH-MM-{target}.md`.

## Requirements

```bash
pip install anthropic
export ANTHROPIC_API_KEY="sk-ant-..."
```

The `math-agent` and `research-agent` sub-agents must also be installed and configured.
See their respective README files.

## Sub-Agent Orchestration

```
qa-agent (orchestrator)
├── static checks         built-in Python, no API
├── → math-agent          PERT, Beta, KDE, copula, KL, CDF correctness
├── → research-agent ×4   pipeline integrity, cache keys, slider flow, dependencies
└── → synthesis (Claude)  unified report with health score + action plan
```

## Adding a New Target

Add an entry to the `TARGETS` dict in `qa-agent.py`:

```python
"my-component": {
    "root": PROJECT_ROOT / "path/to/component",
    "gs_files": ["File.gs", ...],
    "html_files": ["Page.html"],
    "math_files": ["math-heavy-file.gs"],
    "research_questions": [
        ("label", "question text", ["file1.gs", "file2.gs"]),
    ],
}
```

## Adding a New Static Check

Add a function `check_something(...)` in `qa-agent.py` that returns a list of finding dicts:

```python
{ "severity": "FAIL"|"WARN"|"PASS"|"INFO", "check": "check_name", "file": "name:line", "message": "..." }
```

Then call it inside `run_all_static_checks()`.
