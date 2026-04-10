# ProjectCare — Custom GPT Setup

## Files
- `instructions.md` — paste into GPT Builder → Instructions
- `openapi.yaml` — paste into GPT Builder → Actions → Import from schema

## GPT Builder Steps

1. Go to https://chatgpt.com/gpts/editor
2. **Name:** ProjectCare
3. **Description:** Turn three-point estimates into statistically robust confidence intervals. Get P10/P50/P90 distributions, probability of hitting your target, and SACO-optimized risk analysis — for any project task in any unit.
4. **Instructions:** paste full contents of `instructions.md`
5. **Knowledge files:** upload both of the following files (the instructions reference them by name):
   - `knowledge-conversation-flow.md`
   - `knowledge-step4-display.md`
6. **Conversation starters:**
   - "I need to estimate a project"
   - "Check my remaining credits"
   - "I'd like a free trial"
   - "Help me estimate task durations"
7. **Actions → Create new action:** paste `openapi.yaml` contents
   - Authentication: None (key is in the request body)
   - ⚠️ Security note: for production deployments, add an `apiKey` (header) securityScheme to prevent unauthenticated direct calls to the GAS endpoint
8. **Privacy Policy URL:** https://icarenow.io/privacy
9. **Access:** Everyone (public)

## Web App URL
<!-- IMPORTANT: This URL must match the server path in openapi.yaml exactly.
     The URL below is the one currently in openapi.yaml and is the authoritative source. -->
https://script.google.com/macros/s/AKfycbwu2VJv9zMJz3GSb7ijyLqrQzvwweJjS9hP6EFAB9Aao4MNo4vl2zgEil-GcBNACQxp/exec

## Notes
- GAS web app must be deployed: Execute as Me, Access: Anyone
- All actions POST to the same base URL — the `action` field routes them
- Never commit a new GAS deployment URL to source control; rotate via a proxy/vanity endpoint instead
