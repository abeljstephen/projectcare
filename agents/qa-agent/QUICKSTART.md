# QA Agent Quick Start

## 1. Set API key

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

## 2. Run full QA on the Google Sheets add-on

```bash
cd /Users/abeljstephen/pmc-estimator
python agents/qa-agent/qa-agent.py --target google-sheets-addon --scope full
```

## 3. Read the report

```bash
open agents/qa-agent/reports/   # macOS — find the latest .md file
```

## Quick modes

| Command | Time | API calls |
|---|---|---|
| `--scope static` | ~3s | 0 |
| `--scope math` | ~60s | 1 (math-agent) |
| `--scope research` | ~3–5 min | 4 (research-agent) |
| `--scope full` | ~5–8 min | 6 total |

## Invocation phrase (for Claude Code)

> "run qa-agent on ProjectCare google sheet addon"
> "run qa-agent on ProjectCare --scope static"
> "run qa-agent on wordpress plugin"
