# Security & Data Handling — ProjectCare by iCareNOW

## Architecture
- Requests flow: GPT → Google Apps Script Web App → WordPress REST API (icarenow.io)
- The GAS web app validates API keys and runs the SACO estimation engine
- WordPress handles key issuance, credit management, and contact records via FluentCRM

## Data Transmitted
| Data | Purpose | Stored? |
|------|---------|---------|
| API key | Authentication + credit deduction | Yes — hashed in WordPress |
| Task estimates (O/M/P values) | Run probability engine | No — processed in memory only |
| Email address | Trial key delivery only | Yes — in FluentCRM contact record |
| Estimation results | Returned to user | No — not persisted automatically. Yes — if user invokes Save Session: stored in WordPress linked to email/key, retrievable via Load Sessions. |

## Security Controls
- API keys are validated server-side on every request; never exposed in responses
- GAS ↔ WordPress communication uses a shared secret (`X-Projectcare-Secret` header)
- Stripe webhook payloads are verified using HMAC-SHA256 signature validation
- WordPress admin credentials and SMTP passwords are stored in `wp-config.php` (not in the database, not committed to source control)
- All API endpoints served over HTTPS

## Compliance Notes
- No PII beyond email address is collected
- Email is used solely for transactional communication (key delivery, account notices)
- Users may request deletion by contacting icarenow.io
- Privacy policy: https://icarenow.io/privacy
- Terms of service: https://icarenow.io/terms-of-service/
