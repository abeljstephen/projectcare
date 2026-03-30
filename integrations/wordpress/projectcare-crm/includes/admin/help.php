<?php
defined('ABSPATH') || exit;

function pc_page_help(): void {
    if (!current_user_can('manage_options')) return;
    ?>
    <div class="wrap">
        <h1>ProjectCare CRM — Help &amp; Glossary</h1>

        <style>
        .pmc-help h2 { color:#2271b1; border-bottom:2px solid #2271b1; padding-bottom:6px; margin-top:32px; }
        .pmc-help dl dt { font-weight:bold; margin-top:12px; color:#333; }
        .pmc-help dl dd { margin-left:20px; color:#555; line-height:1.6; }
        .pmc-help table.pmc-ref { border-collapse:collapse; width:100%; max-width:700px; margin:12px 0; }
        .pmc-help table.pmc-ref th, .pmc-help table.pmc-ref td { border:1px solid #ddd; padding:8px 12px; text-align:left; }
        .pmc-help table.pmc-ref thead th { background:#f0f0f0; }
        .pmc-help code { background:#f0f0f0; padding:1px 4px; border-radius:3px; }
        </style>

        <div class="pmc-help">

        <!-- Credit System -->
        <h2>The Credit System</h2>
        <dl>
            <dt>Credit</dt>
            <dd>The unit of API consumption. Each GAS call to the ProjectCare deducts one or more credits from the user's balance.</dd>

            <dt>Credits Total</dt>
            <dd>The maximum number of credits on the current plan or top-up. Raise this via the user edit page or by processing a Stripe top-up or renewal.</dd>

            <dt>Credits Used</dt>
            <dd>Cumulative credits consumed since the last reset. Set to 0 on the user edit page to reset.</dd>

            <dt>Credits Remaining</dt>
            <dd>Computed as: <strong>Credits Total &minus; Credits Used</strong>. When this reaches 0, the validate endpoint returns "quota exhausted" and calls are blocked.</dd>
        </dl>

        <h3>Operation Types and Credit Cost</h3>
        <table class="pmc-ref">
            <thead><tr><th>Operation</th><th>Cost (credits)</th><th>What runs</th></tr></thead>
            <tbody>
                <tr><td><code>baseline_only</code></td><td>1</td><td>Baseline distribution generation only (no copula, no optimizer)</td></tr>
                <tr><td><code>full_saco</code></td><td>2</td><td>Full SACO pipeline: baseline + copula reshape + optimizer</td></tr>
                <tr><td><code>saco_explain</code></td><td>4</td><td>Full SACO pipeline + playbooks + detailed diagnostics</td></tr>
            </tbody>
        </table>
        <p><strong>Example:</strong> A user with 20 trial credits who runs <code>full_saco</code> three times uses 6 credits and has 14 remaining.</p>

        <!-- API Keys -->
        <h2>API Keys</h2>
        <dl>
            <dt>API Key</dt>
            <dd>A 64-character hex string generated with <code>bin2hex(random_bytes(32))</code>. Sent in every GAS request to authenticate the user. Never displayed in plain text to end users after initial issuance — only a masked preview is shown in admin.</dd>

            <dt>Key Status</dt>
            <dd>
                <table class="pmc-ref" style="margin-top:8px">
                    <thead><tr><th>Status</th><th>Can call API?</th><th>Notes</th></tr></thead>
                    <tbody>
                        <tr><td><code>active</code></td><td>Yes</td><td>Normal operating state</td></tr>
                        <tr><td><code>expired</code></td><td>No</td><td>key_expires date passed; auto-set by validate endpoint</td></tr>
                        <tr><td><code>inactive</code></td><td>No</td><td>Manually set by admin</td></tr>
                        <tr><td><code>suspended</code></td><td>No</td><td>Admin suspended; user sees generic "inactive" message</td></tr>
                        <tr><td><code>cancelled</code></td><td>No</td><td>Stripe subscription cancelled event received</td></tr>
                        <tr><td><code>superseded</code></td><td>No</td><td>A new subscription key replaced this one</td></tr>
                    </tbody>
                </table>
            </dd>

            <dt>Key Expires</dt>
            <dd>The date (YYYY-MM-DD) after which the key is considered expired. The validate endpoint checks this on every call and auto-marks the key as expired when the date passes.</dd>

            <dt>Key Regeneration</dt>
            <dd>Generates a new 64-char key, updates the database, marks the old key as superseded, and emails the user the new key. The old key stops working immediately.</dd>
        </dl>

        <!-- Plans & Pricing -->
        <h2>Plans &amp; Pricing</h2>
        <dl>
            <dt>Plan</dt>
            <dd>A named tier of service. Plans control the number of credits and subscription duration assigned on purchase.
                <table class="pmc-ref" style="margin-top:8px">
                    <thead><tr><th>Slug</th><th>Credits</th><th>Days</th><th>Min Price</th></tr></thead>
                    <tbody>
                        <tr><td>trial</td><td>20</td><td>10</td><td>Free</td></tr>
                        <tr><td>starter</td><td>25</td><td>35</td><td>$5</td></tr>
                        <tr><td>professional</td><td>55</td><td>35</td><td>$10</td></tr>
                        <tr><td>team</td><td>130</td><td>35</td><td>$20</td></tr>
                        <tr><td>enterprise</td><td>999,999</td><td>35</td><td>$40</td></tr>
                    </tbody>
                </table>
            </dd>

            <dt>price_min_cents</dt>
            <dd>The minimum Stripe payment amount (in cents) that maps to this plan. When a Stripe checkout completes, the paid amount is compared against plans from highest to lowest to determine the plan. For example, a $12 payment maps to <code>professional</code> (min $10) because it is above $10 and below $20.</dd>

            <dt>Trial</dt>
            <dd>A free 10-day key with 20 credits. Issued via the <code>/trial</code> REST endpoint. One trial per email. Cannot be issued while trial_paused is enabled.</dd>
        </dl>

        <!-- Promo Codes -->
        <h2>Promo Codes</h2>
        <dl>
            <dt>Promo Code</dt>
            <dd>A short alphanumeric code that modifies trial issuance. When a user submits a promo code with their trial request, the promo's overrides are applied: extra credits, a different plan, or a longer expiry. Codes track usage count against an optional maximum.</dd>

            <dt>credits_grant</dt>
            <dd>If set, replaces the normal plan's credit count when the promo is used.</dd>

            <dt>plan_override</dt>
            <dd>If set, assigns this plan slug instead of "trial".</dd>

            <dt>days_override</dt>
            <dd>If set, extends the key expiry by this many days instead of the plan default.</dd>

            <dt>max_uses</dt>
            <dd>If null, the code has unlimited uses. If set, uses_count must be below max_uses for the code to be valid.</dd>
        </dl>

        <!-- GAS Quota -->
        <h2>GAS Quota</h2>
        <dl>
            <dt>GAS</dt>
            <dd>Google Apps Script — the serverless runtime that hosts the ProjectCare computation engine. Calls from ChatGPT pass through the WordPress REST API and are forwarded to the GAS web app deployment.</dd>

            <dt>Daily Runtime Quota</dt>
            <dd>Google enforces a per-day cumulative execution time limit:
                <ul style="margin:4px 0 4px 20px">
                    <li>Consumer accounts (personal Gmail): <strong>90 minutes/day</strong></li>
                    <li>Google Workspace accounts: <strong>360 minutes/day</strong></li>
                </ul>
                Quotas reset daily at midnight Pacific time.
            </dd>

            <dt>URL Fetch Quota</dt>
            <dd>Each outbound HTTP request from GAS counts toward the URL Fetch quota (20,000/day consumer, 100,000/day Workspace). ProjectCare makes one fetch per call to the WordPress validation endpoint.</dd>

            <dt>Why runtime is the binding constraint</dt>
            <dd>A full SACO pipeline run takes ~2–6 seconds. At 90 min/day, that limits consumer accounts to roughly 900–2700 calls/day before hitting quota. URL Fetch rarely becomes the bottleneck.</dd>

            <dt>What happens when quota is hit</dt>
            <dd>GAS throws a quota exception and the web app returns an error. The WordPress validate endpoint logs these as <code>result=fail</code> entries. No credits are deducted for failed validates.</dd>
        </dl>

        <!-- Rate Limits -->
        <h2>Rate Limits</h2>
        <dl>
            <dt>Per-IP Rate Limiting</dt>
            <dd>Each REST endpoint tracks call counts per IP address using WordPress transients. If a single IP exceeds the configured threshold within the time window, subsequent requests receive a 200 response with <code>{"error": "Too many requests"}</code>. No credits are deducted for rate-limited requests.</dd>

            <dt>Global Rate Limit</dt>
            <dd>An optional ceiling across all IPs combined. Set to 0 to disable. Useful for protecting GAS quota during traffic spikes.</dd>
        </dl>

        <!-- Stripe Integration -->
        <h2>Stripe Integration</h2>
        <dl>
            <dt>Handled events</dt>
            <dd>
                <table class="pmc-ref">
                    <thead><tr><th>Event</th><th>Action</th></tr></thead>
                    <tbody>
                        <tr><td><code>checkout.session.completed</code> (subscription)</td><td>Create or update user, issue new key, send subscription email</td></tr>
                        <tr><td><code>checkout.session.completed</code> (payment)</td><td>Add top-up credits to existing account</td></tr>
                        <tr><td><code>invoice.payment_succeeded</code></td><td>Reset credits, extend expiry by 35 days (renewal)</td></tr>
                        <tr><td><code>customer.subscription.deleted</code></td><td>Mark key as cancelled</td></tr>
                    </tbody>
                </table>
            </dd>

            <dt>Deduplication</dt>
            <dd>Each Stripe event ID is stored in a 24-hour transient. Replayed events within that window are silently acknowledged without reprocessing.</dd>
        </dl>

        <!-- Stripe Payment Fields -->
        <h2>Stripe Payment Record Fields</h2>
        <p>Every successful Stripe payment is stored in <code>wp_pc_payments</code>. The fields below are captured from the webhook payload and viewable on each user's detail page and via the Payments CSV export.</p>
        <table class="pmc-ref">
            <thead><tr><th>Field</th><th>Description</th><th>Example</th></tr></thead>
            <tbody>
                <tr><td><code>type</code></td><td>Payment type: <code>subscription</code> (new plan), <code>renewal</code> (recurring charge), or <code>topup</code> (one-time credit purchase)</td><td><code>renewal</code></td></tr>
                <tr><td><code>plan</code></td><td>PMC plan slug associated with this payment (derived from amount)</td><td><code>professional</code></td></tr>
                <tr><td><code>amount_cents</code></td><td>Amount charged in the smallest currency unit (cents for USD). Divide by 100 for dollars.</td><td><code>2900</code> → $29.00</td></tr>
                <tr><td><code>currency</code></td><td>ISO 4217 currency code, lowercase</td><td><code>usd</code></td></tr>
                <tr><td><code>stripe_payment_intent</code></td><td>Stripe Payment Intent ID — the primary payment authorization reference. Use this in the Stripe Dashboard to find, dispute, or refund a charge.</td><td><code>pi_3N…</code></td></tr>
                <tr><td><code>stripe_invoice_id</code></td><td>Stripe Invoice ID — present for subscription and renewal payments. Use this to download the PDF invoice or cross-reference in accounting.</td><td><code>in_1N…</code></td></tr>
                <tr><td><code>stripe_subscription_id</code></td><td>Stripe Subscription ID — the recurring billing contract. Cancelling or modifying a subscription in Stripe references this ID.</td><td><code>sub_1N…</code></td></tr>
                <tr><td><code>stripe_customer_id</code></td><td>Stripe Customer ID — persists across all payments for this email. Links the user to their full Stripe billing history.</td><td><code>cus_1N…</code></td></tr>
                <tr><td><code>stripe_price_id</code></td><td>Stripe Price ID — the specific price (SKU) that was billed. Identifies the plan tier and billing interval.</td><td><code>price_1N…</code></td></tr>
                <tr><td><code>stripe_product_id</code></td><td>Stripe Product ID — the top-level product the price belongs to (e.g., "ProjectCare Professional").</td><td><code>prod_1N…</code></td></tr>
                <tr><td><code>stripe_charge_id</code></td><td>Stripe Charge ID — the actual card charge. Use this for refund operations or dispute evidence.</td><td><code>ch_1N…</code></td></tr>
                <tr><td><code>billing_reason</code></td><td>Why the invoice was generated. Common values: <code>subscription_create</code>, <code>subscription_cycle</code>, <code>one_time</code>.</td><td><code>subscription_cycle</code></td></tr>
                <tr><td><code>period_start</code> / <code>period_end</code></td><td>The service period this payment covers (from the invoice line item). Useful for reconciling SaaS revenue with the correct accounting period.</td><td>2026-03-01 → 2026-04-01</td></tr>
                <tr><td><code>coupon_code</code></td><td>Stripe coupon ID applied at checkout, if any. Blank if no discount was applied.</td><td><code>LAUNCH50</code></td></tr>
                <tr><td><code>status</code></td><td>Payment outcome — always <code>succeeded</code> for rows in this table (failures are not stored).</td><td><code>succeeded</code></td></tr>
            </tbody>
        </table>

        <!-- Admin Terms -->
        <h2>Admin Terms</h2>
        <dl>
            <dt>Source</dt>
            <dd>How the user was created:
                <ul style="margin:4px 0 4px 20px">
                    <li><strong>trial</strong> — came via the /trial REST endpoint</li>
                    <li><strong>stripe</strong> — came via a Stripe webhook checkout event</li>
                    <li><strong>manual</strong> — created or edited by an admin</li>
                    <li><strong>import</strong> — imported via CSV or FluentCRM migration</li>
                </ul>
            </dd>

            <dt>Activity Log</dt>
            <dd>An append-only record of every significant event: trial requests, validates, deducts, key regens, Stripe events, admin edits, emails sent. Rows are never modified after insertion. Use the prune tool to delete old rows.</dd>

            <dt>Failed Execution</dt>
            <dd>A <code>validate</code> or <code>deduct</code> activity row where <code>result != 'success'</code>. High failure rates may indicate GAS quota exhaustion, incorrect API key configuration, or rate limiting.</dd>

            <dt>FluentCRM Sync</dt>
            <dd>When enabled in Settings, user data is mirrored to FluentCRM contacts (email, plan, credits, key, quota tags). The PMC plugin stores all data in its own tables and is fully functional without FluentCRM. Disabling sync is safe at any time.</dd>
        </dl>

        </div>
    </div>
    <?php
}
