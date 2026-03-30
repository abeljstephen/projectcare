# API Monitor Agent

Monitors Anthropic API usage and costs for ProjectCare agents.

## Usage

```bash
# Full report (all time)
python3 agents/api-monitor-agent/check-usage.py

# Last 7 days only
python3 agents/api-monitor-agent/check-usage.py --days 7

# JSON output (for scripting)
python3 agents/api-monitor-agent/check-usage.py --json
```

## Setup

1. Add your API key to `agents/api-monitor-agent/.env`:
   ```
   ANTHROPIC_API_KEY=sk-ant-api03-...
   ```
   Or export it: `export ANTHROPIC_API_KEY="sk-ant-..."`

2. The `.env` file is gitignored — never committed.

## What It Reads

- `system-google-sheets-addon/config/logs/api-usage.json` — local log written by `APIClient` / `UsageTracker` whenever math-agent, research-agent, or qa-agent makes an API call
- For real-time Anthropic billing: https://platform.claude.com/usage#rate-limit-usage

## Output

- Terminal cost report with per-agent and per-day breakdown
- Monthly spend projection based on daily average
- Warning when total spend exceeds $50 threshold
- Updates `agents/api-monitor-agent/api-tracker.md` with history
