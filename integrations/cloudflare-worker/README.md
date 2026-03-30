# ProjectCare Proxy — Cloudflare Worker

Proxies GPT requests to GAS so users see `icarenow.io` (or your worker domain)
instead of `script.google.com`.

## Setup (one-time, ~10 minutes)

### 1 — Sign up for Cloudflare (free)
Go to https://dash.cloudflare.com/sign-up — free account, no credit card needed.

### 2 — Deploy via Cloudflare Dashboard (no CLI needed)

1. Log into https://dash.cloudflare.com
2. Click **Workers & Pages** → **Create** → **Create Worker**
3. Name it `projectcare-proxy`
4. Click **Edit code**
5. Delete the default code and paste the full contents of `worker.js`
6. Click **Deploy**
7. Your worker URL will be: `https://projectcare-proxy.YOUR-SUBDOMAIN.workers.dev`

### 3 — Update openapi.yaml

Replace the `servers` block in `integrations/gpt/openapi.yaml`:

```yaml
servers:
  - url: https://projectcare-proxy.YOUR-SUBDOMAIN.workers.dev

paths:

  /:
```

Then update the path from the long GAS URL to just `/`.

### 4 — Paste updated YAML into GPT Builder → Actions

GPT will now show `projectcare-proxy.workers.dev` (or your custom domain).

---

## Optional: Use a custom domain (e.g. api.icarenow.io)

If icarenow.io is on Cloudflare:
1. Workers & Pages → your worker → **Triggers** → **Add Custom Domain**
2. Enter `api.icarenow.io`
3. Update `servers.url` in openapi.yaml to `https://api.icarenow.io`
4. GPT will show `icarenow.io` ✓

## Free tier limits
- 100,000 requests/day
- 10ms CPU time per request
- No monthly fee
