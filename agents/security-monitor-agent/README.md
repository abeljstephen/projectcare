# Security Monitor Agent

Runs static and AI-powered security checks across the entire ProjectCare codebase.

## Usage

```bash
# Static checks only — fast, no API key needed (default)
python3 agents/security-monitor-agent/security-agent.py --scope static

# Static + research-agent deep reviews
python3 agents/security-monitor-agent/security-agent.py --scope research

# Full: static + research + Claude synthesis report
python3 agents/security-monitor-agent/security-agent.py --scope full

# Skip API cost-gate prompt (CI / automation)
python3 agents/security-monitor-agent/security-agent.py --scope full --no-confirm
```

## What It Checks

### Phase 1–5: Static Checks (no API)

| ID | Check | OWASP |
|----|-------|-------|
| SEC-001 | .env files tracked in git | A02 |
| SEC-002 | Hardcoded API keys (Anthropic, OpenAI, Google, AWS) | A02 |
| SEC-003 | Private key / service account files in git | A02 |
| SEC-004 | Secrets in recent git history (last 20 commits) | A02 |
| SEC-010 | eval() / new Function() / exec() in JS/Python | A03 |
| SEC-011 | subprocess with shell=True or os.system() | A03 |
| SEC-012 | Path traversal in file operations | A03 |
| SEC-013 | UrlFetchApp with dynamic URLs (SSRF) | A10 |
| SEC-014 | pickle.loads / unsafe yaml.load | A08 |
| SEC-020 | innerHTML / document.write without escaping | A03 |
| SEC-021 | Open redirect via window.location | A01 |
| SEC-022 | Sensitive field names in Logger/console.log | A09 |
| SEC-023 | Missing Content-Security-Policy meta tag | A05 |
| SEC-030 | PHP files without ABSPATH guard | A05 |
| SEC-031 | Unescaped PHP echo/print | A03 |
| SEC-032 | Missing nonce verification on $_POST/$_GET | A01 |
| SEC-033 | Unsanitised $_POST/$_GET/$_REQUEST | A03 |
| SEC-040 | OAuth scopes wider than necessary | A01 |
| SEC-041 | GAS script properties with hardcoded secrets | A07 |
| SEC-042 | HtmlService output without escaping | A03 |

### Phase 6: Research-Agent Deep Reviews (API required)

| ID | Topic |
|----|-------|
| SEC-050 | Python agent security (subprocess, path traversal, key leakage) |
| SEC-051 | GAS data flow — server-to-client data leakage |
| SEC-052 | WordPress plugin JS — XSS, open redirect, storage |

## Severity Levels

| Level | Meaning |
|-------|---------|
| CRITICAL | Immediate exploitable risk or confirmed credential exposure |
| HIGH | Likely exploitable — fix before next release |
| MEDIUM | Defensive gap — address this sprint |
| LOW | Best-practice deviation |
| INFO | Observation only |

## Adding New Checks

1. Add a task block to `SECURITY_PLAN.md`
2. Add a `check_xxx()` function in `security-agent.py` returning a list of findings
3. Call it from `run_all_static_checks()` for static checks, or add to `_RESEARCH_QUESTIONS` for research checks

## Invocation phrase (for Claude Code)

> "run security-agent on ProjectCare"
> "run security scan --scope static"
> "run full security audit"
