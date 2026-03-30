# ProjectCare — Security Monitor Plan

> Living document. Add new tasks by appending blocks in the same format below.
> The security-agent reads this file and runs all enabled tasks in phase order.

---

## Phase 1 — Secrets & Credentials  (static, no API)

```yaml
id: SEC-001
title: Tracked .env files with live credentials
phase: static
severity: CRITICAL
enabled: true
description: >
  Scan every file tracked by git for .env files that contain recognisable
  secret patterns. A .env file committed to git exposes credentials to
  anyone with repo access.
pass_when: No .env (or equivalent) file with live credential patterns is tracked by git.
files: ["."]
```

```yaml
id: SEC-002
title: Hardcoded Anthropic / OpenAI / Google API keys
phase: static
severity: CRITICAL
enabled: true
description: >
  Scan all tracked source files for regex patterns matching known API key
  formats: Anthropic (sk-ant-api), OpenAI (sk-[48]), Google (AIza[35]),
  AWS (AKIA[20]), and generic secret= / api_key= / password= assignments
  with non-placeholder values.
pass_when: No live credential patterns found in tracked files.
files: ["**/*.gs", "**/*.js", "**/*.py", "**/*.php", "**/*.html", "**/*.json", "**/*.md"]
```

```yaml
id: SEC-003
title: Private key files tracked in git
phase: static
severity: CRITICAL
enabled: true
description: >
  Detect *.pem, *.key, *.p12, *.pfx, service-account*.json, and
  credentials*.json files anywhere in the tracked tree.
pass_when: No private key material in tracked files.
files: ["."]
```

```yaml
id: SEC-004
title: Secrets in git history (recent commits)
phase: static
severity: HIGH
enabled: true
description: >
  Scan the diff of the last 20 commits for Anthropic/OpenAI/Google key
  patterns that may have been committed and then removed. Even removed
  secrets remain in git history.
pass_when: No secret patterns found in recent git history diffs.
files: ["."]
```

---

## Phase 2 — Injection & Execution  (static, no API)

```yaml
id: SEC-010
title: eval() / new Function() in JavaScript and Python
phase: static
severity: HIGH
enabled: true
description: >
  Detect eval(), new Function(...), exec(), compile() used on
  non-literal strings in JS (.js, Plot.html) and Python (.py) files.
  Dynamic code execution on attacker-controlled input is RCE.
pass_when: No eval/exec/new Function calls on dynamic input found.
files: ["**/*.js", "**/*.html", "**/*.py"]
```

```yaml
id: SEC-011
title: subprocess / os.system with shell=True or string commands
phase: static
severity: HIGH
enabled: true
description: >
  subprocess.run/call/Popen with shell=True, or os.system()/os.popen()
  with any argument, are command-injection vectors if any part of the
  command is user-controlled.
pass_when: No shell=True or os.system calls found; all subprocess calls use list args.
files: ["**/*.py"]
```

```yaml
id: SEC-012
title: Path traversal in file operations
phase: static
severity: HIGH
enabled: true
description: >
  Python file opens (open(), Path().read_text()) that construct paths
  using string concatenation or f-strings with external input, without
  calling .resolve() or checking against an allowed base directory.
pass_when: All file path operations use controlled, non-user-supplied paths.
files: ["**/*.py"]
```

```yaml
id: SEC-013
title: UrlFetchApp in GAS with dynamic URLs
phase: static
severity: HIGH
enabled: true
description: >
  UrlFetchApp.fetch() calls where the URL is constructed from a variable
  or concatenation. Unvalidated URLs could be used for SSRF
  (Server-Side Request Forgery) or data exfiltration.
pass_when: UrlFetchApp calls use only validated/whitelisted URL strings.
files: ["**/*.gs"]
```

```yaml
id: SEC-014
title: pickle.loads / yaml.load (unsafe deserialization)
phase: static
severity: HIGH
enabled: true
description: >
  pickle.loads(), yaml.load() without Loader=yaml.SafeLoader, and
  marshal.loads() can execute arbitrary code when deserializing
  attacker-controlled data.
pass_when: No unsafe deserialization calls found.
files: ["**/*.py"]
```

---

## Phase 3 — XSS & DOM Injection  (static, no API)

```yaml
id: SEC-020
title: innerHTML / document.write without escaping
phase: static
severity: HIGH
enabled: true
description: >
  Detect innerHTML and document.write() assignments in JS/HTML files.
  For each occurrence, verify the right-hand side is either a static
  string literal or passes through an escaping function (escHtml,
  textContent, DOMPurify, etc.). Flag any that use raw variables or
  template literals with unsanitised interpolation.
pass_when: All innerHTML/document.write calls use static strings or escHtml-wrapped values.
files: ["**/*.js", "**/*.html"]
```

```yaml
id: SEC-021
title: Open redirect via window.location or location.href
phase: static
severity: MEDIUM
enabled: true
description: >
  Detect assignments to window.location, location.href, location.replace()
  that include a variable not validated against a whitelist.
pass_when: No window.location assignments with unvalidated variable input found.
files: ["**/*.js", "**/*.html"]
```

```yaml
id: SEC-022
title: Sensitive data in Logger.log / console.log
phase: static
severity: MEDIUM
enabled: true
description: >
  Detect Logger.log() or console.log() calls that log objects likely to
  contain credentials, tokens, full API payloads, or PII (detect keywords:
  apiKey, token, password, secret, key, credentials in the logged value).
pass_when: No logging of sensitive field names in production code paths.
files: ["**/*.gs", "**/*.js"]
```

```yaml
id: SEC-023
title: Content Security Policy missing in HTML files
phase: static
severity: LOW
enabled: true
description: >
  Check Plot.html and templates/estimator.html for a Content-Security-Policy
  meta tag or equivalent header. Absence allows unrestricted script execution.
pass_when: CSP meta tag or header present in each standalone HTML page.
files: ["Plot.html", "templates/estimator.html"]
```

---

## Phase 4 — WordPress / PHP Security  (static, no API)

```yaml
id: SEC-030
title: Missing ABSPATH guard in PHP files
phase: static
severity: HIGH
enabled: true
description: >
  Every PHP file in the WordPress plugin must begin with
  `if ( ! defined( 'ABSPATH' ) ) exit;` to prevent direct execution.
pass_when: All PHP files have the ABSPATH guard on their first executable line.
files: ["**/*.php"]
```

```yaml
id: SEC-031
title: Unescaped output in PHP
phase: static
severity: HIGH
enabled: true
description: >
  Detect echo, print, printf statements that output variables or expressions
  without esc_html(), esc_attr(), wp_kses(), or esc_url() wrapping.
pass_when: All dynamic PHP output uses WordPress escaping functions.
files: ["**/*.php"]
```

```yaml
id: SEC-032
title: Missing nonce verification on $_POST/$_GET handlers
phase: static
severity: HIGH
enabled: true
description: >
  Any PHP code that reads $_POST, $_GET, or $_REQUEST must verify a nonce
  via wp_verify_nonce() or check_admin_referer() before acting on the data.
pass_when: All $_POST/$_GET reads are accompanied by nonce verification.
files: ["**/*.php"]
```

```yaml
id: SEC-033
title: Unsanitised $_POST/$_GET/$_REQUEST in PHP
phase: static
severity: HIGH
enabled: true
description: >
  Detect direct use of $_POST, $_GET, $_REQUEST values passed to functions
  without sanitize_text_field(), intval(), absint(), esc_*(), or equivalent.
pass_when: All $_POST/$_GET/$_REQUEST values are sanitized before use.
files: ["**/*.php"]
```

---

## Phase 5 — GAS / OAuth Scope Analysis  (static, no API)

```yaml
id: SEC-040
title: OAuth scopes wider than necessary
phase: static
severity: MEDIUM
enabled: true
description: >
  Review appsscript.json OAuth scopes. Flag any scope that grants access
  broader than the add-on's documented functionality (e.g., drive,
  gmail, admin scopes are not needed for a Sheets-only add-on).
pass_when: Only spreadsheets, script.container.ui, and userinfo scopes declared.
files: ["appsscript.json"]
```

```yaml
id: SEC-041
title: GAS script properties storing secrets
phase: static
severity: MEDIUM
enabled: true
description: >
  Detect PropertiesService.getScriptProperties().setProperty() calls
  where the value is a hardcoded string that looks like a credential.
  Script properties are stored encrypted but should not be set from code.
pass_when: No credential-like literals passed to setProperty().
files: ["**/*.gs"]
```

```yaml
id: SEC-042
title: HtmlService output without explicit escaping
phase: static
severity: MEDIUM
enabled: true
description: >
  HtmlService.createHtmlOutput() or createTemplate() calls that embed
  GAS variables directly into HTML strings without calling
  HtmlService.htmlEscape() or using <?= ?> auto-escape syntax.
pass_when: All HtmlService output uses proper escaping mechanisms.
files: ["**/*.gs"]
```

---

## Phase 6 — Deep Review via Research Agent  (API required)

```yaml
id: SEC-050
title: Python agent security review (subprocess, path, secrets)
phase: research
sub_agent: research-agent
severity: HIGH
enabled: true
description: >
  Deep review of all Python agent files for: command injection via
  subprocess argument construction, path traversal in file operations,
  any accidental secret exposure in output or logs, and safe handling
  of the ANTHROPIC_API_KEY throughout call chains.
pass_when: No injection vectors, no secret leakage, all paths controlled.
files: ["agents/qa-agent/qa-agent.py", "agents/math-agent/math-auditor.py",
        "agents/research-agent/research-agent.py",
        "agents/api-monitor-agent/check-usage.py",
        "system-google-sheets-addon/config/config-api/credentials.py",
        "system-google-sheets-addon/config/config-api/api_client.py"]
```

```yaml
id: SEC-051
title: GAS data flow — does any path leak credentials or PII to client?
phase: research
sub_agent: research-agent
severity: HIGH
enabled: true
description: >
  Trace the complete server → client data path: pmcEstimatorAPI() →
  adaptResponse() → Plot.html. Determine whether any field in the
  response payload could expose internal state, user identity data,
  or anything from PropertiesService/SessionService that should
  remain server-side. Check what Plot.html renders and whether any
  server field is echoed back verbatim to DOM or localStorage.
pass_when: No server-side credential or identity data reaches the client DOM.
files: ["system-google-sheets-addon/core/main/main.gs",
        "system-google-sheets-addon/core/variable_map/adapter.gs",
        "system-google-sheets-addon/Plot.html"]
```

```yaml
id: SEC-052
title: WordPress plugin JS security audit (XSS, open redirect, storage)
phase: research
sub_agent: research-agent
severity: MEDIUM
enabled: true
description: >
  Audit the WordPress browser engine for: (1) any innerHTML/document.write
  call where the value is not passed through escHtml(), (2) any
  window.location redirect with user-supplied values, (3) any data stored
  in localStorage or sessionStorage that could include credentials or PII,
  (4) any external fetch() or XHR call that could be redirected by
  attacker-controlled input.
pass_when: All DOM writes are escaped; no sensitive data in browser storage; no open redirects.
files: ["wordpress-plugin/pmc-estimator/assets/js/app.js",
        "wordpress-plugin/pmc-estimator/assets/js/engine/saco.js",
        "wordpress-plugin/pmc-estimator/templates/estimator.html"]
```

---

## Template — Add New Security Task

```yaml
id: SEC-XXX
title: Short descriptive title
phase: static  # or: research
sub_agent: research-agent  # only for phase=research
severity: CRITICAL  # CRITICAL | HIGH | MEDIUM | LOW
enabled: true
description: >
  What the check looks for and why it matters.
pass_when: Condition that makes this check green.
files: ["relative/path/to/file.ext"]
```
