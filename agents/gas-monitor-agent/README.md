# limits-monitor

Tracks Google Apps Script deployment and version slot usage for the ProjectCare add-on.

## Usage

```bash
bash agents/limits-monitor/check-limits.sh
```

Outputs a status report and updates `deploy-tracker.md` in this directory.

## Limits (as of 2024)

| Resource    | Hard Limit |
|-------------|-----------|
| Deployments | 20        |
| Versions    | 100       |

## Rules

- `clasp push` → HEAD only. No slots consumed. Push freely.
- `clasp deploy` → consumes 1 deployment slot. Major releases only.
- `clasp version` → consumes 1 version slot. Milestone snapshots only.

## Files

- `check-limits.sh` — run manually or via cron to refresh counts
- `deploy-tracker.md` — auto-updated status file (do not edit by hand)
