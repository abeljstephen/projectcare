# ProjectCare — Custom GPT Setup

## Files
- `instructions.md` — paste into GPT Builder → Instructions
- `openapi.yaml` — paste into GPT Builder → Actions → Import from schema

## GPT Builder Steps

1. Go to https://chatgpt.com/gpts/editor
2. **Name:** ProjectCare
3. **Description:** Turn three-point estimates into statistically robust confidence intervals. Get P10/P50/P90 distributions, probability of hitting your target, and SACO-optimized risk analysis — for any project task in any unit.
4. **Instructions:** paste full contents of `instructions.md`
5. **Conversation starters:**
   - "I need to estimate a project"
   - "Check my remaining credits"
   - "I'd like a free trial"
   - "Help me estimate task durations"
6. **Actions → Create new action:** paste `openapi.yaml` contents
   - Authentication: None (key is in the request body)
7. **Privacy Policy URL:** https://icarenow.io/privacy
8. **Access:** Everyone (public)

## Web App URL
https://script.google.com/macros/s/AKfycbwiOq86Xx8-yFdnTWG6QSrYkGIR0A47CD7YydiGeTLB8hHS0jS6012Z7RBBCACu_b9S/exec

## Notes
- GAS web app must be deployed: Execute as Me, Access: Anyone
- All three actions POST to the same base URL — the `action` field routes them
