<?php
defined('ABSPATH') || exit;

/**
 * Seed default HTML email templates if the table is empty.
 */
function pc_seed_email_templates(): void {
    global $wpdb;
    $table = $wpdb->prefix . 'pc_email_templates';
    $count = (int) $wpdb->get_var("SELECT COUNT(*) FROM `{$table}`");
    if ($count > 0) return;

    $site = get_bloginfo('name') ?: 'iCareNOW';
    $base_style = 'font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333;';
    $h2_style   = 'color:#2271b1;border-bottom:2px solid #2271b1;padding-bottom:8px;';
    $p_style    = 'line-height:1.6;';
    $key_style  = 'background:#f0f0f0;border:1px solid #ddd;padding:12px;border-radius:4px;font-family:monospace;font-size:14px;word-break:break-all;';
    $btn_style  = 'display:inline-block;background:#2271b1;color:#fff;padding:10px 20px;text-decoration:none;border-radius:4px;';
    $footer     = '<hr style="border:none;border-top:1px solid #eee;margin:24px 0"><p style="font-size:12px;color:#999">iCareNOW &mdash; icarenow.io &mdash; ProjectCare</p>';

    $templates = [
        [
            'slug'      => 'trial_issued',
            'label'     => 'Trial Key Issued',
            'subject'   => 'Your ProjectCare Trial Key',
            'body_html' => "<div style=\"{$base_style}\">
<h2 style=\"{$h2_style}\">Welcome to ProjectCare</h2>
<p style=\"{$p_style}\">Hi {{email}},</p>
<p style=\"{$p_style}\">Your 10-day trial key is ready. Paste it when the ProjectCare GPT asks for your key.</p>
<div style=\"{$key_style}\">{{key}}</div>
<p style=\"{$p_style}\"><strong>Plan:</strong> {{plan}}<br><strong>Credits:</strong> {{credits}}<br><strong>Expires:</strong> {{expiry}}</p>
<p style=\"{$p_style}\">When your trial ends, upgrade for full access:</p>
<a href=\"{{upgrade_url}}\" style=\"{$btn_style}\">Upgrade Now</a>
{$footer}
</div>",
        ],
        [
            'slug'      => 'subscription_issued',
            'label'     => 'Subscription Key Issued',
            'subject'   => 'Your ProjectCare Subscription Key',
            'body_html' => "<div style=\"{$base_style}\">
<h2 style=\"{$h2_style}\">Thank You for Subscribing</h2>
<p style=\"{$p_style}\">Hi {{email}},</p>
<p style=\"{$p_style}\">Your subscription is active. Here is your API key:</p>
<div style=\"{$key_style}\">{{key}}</div>
<p style=\"{$p_style}\"><strong>Plan:</strong> {{plan}}<br><strong>Credits:</strong> {{credits}}<br><strong>Expires:</strong> {{expiry}}</p>
<p style=\"{$p_style}\">Paste this key when the ProjectCare GPT asks for it.</p>
<a href=\"{{upgrade_url}}\" style=\"{$btn_style}\">Manage Subscription</a>
{$footer}
</div>",
        ],
        [
            'slug'      => 'renewal',
            'label'     => 'Subscription Renewed',
            'subject'   => 'ProjectCare — Subscription Renewed',
            'body_html' => "<div style=\"{$base_style}\">
<h2 style=\"{$h2_style}\">Subscription Renewed</h2>
<p style=\"{$p_style}\">Hi {{email}},</p>
<p style=\"{$p_style}\">Your {{plan}} subscription has been renewed. Your credits have been reset.</p>
<p style=\"{$p_style}\"><strong>Credits:</strong> {{credits}}<br><strong>New Expiry:</strong> {{expiry}}</p>
{$footer}
</div>",
        ],
        [
            'slug'      => 'low_credits_25',
            'label'     => 'Low Credits Warning (25%)',
            'subject'   => 'ProjectCare — 25% of Credits Remaining',
            'body_html' => "<div style=\"{$base_style}\">
<h2 style=\"{$h2_style}\">Credits Running Low</h2>
<p style=\"{$p_style}\">Hi {{email}},</p>
<p style=\"{$p_style}\">You have used 75% of your {{plan}} plan credits. You have {{credits_remaining}} of {{credits_total}} credits remaining.</p>
<p style=\"{$p_style}\">Upgrade or top up to keep running estimations without interruption.</p>
<a href=\"{{upgrade_url}}\" style=\"{$btn_style}\">Top Up or Upgrade</a>
{$footer}
</div>",
        ],
        [
            'slug'      => 'low_credits_10',
            'label'     => 'Low Credits Warning (10%)',
            'subject'   => 'ProjectCare — Only ' . '{{credits_remaining}} Credits Left',
            'body_html' => "<div style=\"{$base_style}\">
<h2 style=\"{$h2_style}\">Almost Out of Credits</h2>
<p style=\"{$p_style}\">Hi {{email}},</p>
<p style=\"{$p_style}\">You have only {{credits_remaining}} of {{credits_total}} credits remaining on your {{plan}} plan.</p>
<p style=\"{$p_style}\">Act now to avoid service interruption.</p>
<a href=\"{{upgrade_url}}\" style=\"{$btn_style}\">Top Up Now</a>
{$footer}
</div>",
        ],
        [
            'slug'      => 'exhausted',
            'label'     => 'Credits Exhausted',
            'subject'   => 'ProjectCare — No Credits Remaining',
            'body_html' => "<div style=\"{$base_style}\">
<h2 style=\"{$h2_style}\">Credits Exhausted</h2>
<p style=\"{$p_style}\">Hi {{email}},</p>
<p style=\"{$p_style}\">You have used all {{credits_total}} credits on your {{plan}} plan. Estimations are paused until you add more credits.</p>
<a href=\"{{upgrade_url}}\" style=\"{$btn_style}\">Add Credits</a>
{$footer}
</div>",
        ],
        [
            'slug'      => 'expired',
            'label'     => 'Key Expired',
            'subject'   => 'ProjectCare — Your Key Has Expired',
            'body_html' => "<div style=\"{$base_style}\">
<h2 style=\"{$h2_style}\">Key Expired</h2>
<p style=\"{$p_style}\">Hi {{email}},</p>
<p style=\"{$p_style}\">Your {{plan}} key expired on {{expiry}}. Renew your subscription to continue using ProjectCare.</p>
<a href=\"{{upgrade_url}}\" style=\"{$btn_style}\">Renew Subscription</a>
{$footer}
</div>",
        ],
        [
            'slug'      => 'key_regen',
            'label'     => 'API Key Regenerated',
            'subject'   => 'ProjectCare — Your API Key Has Been Reset',
            'body_html' => "<div style=\"{$base_style}\">
<h2 style=\"{$h2_style}\">New API Key Issued</h2>
<p style=\"{$p_style}\">Hi {{email}},</p>
<p style=\"{$p_style}\">Your API key has been regenerated. Your old key is no longer valid. Here is your new key:</p>
<div style=\"{$key_style}\">{{key}}</div>
<p style=\"{$p_style}\"><strong>Plan:</strong> {{plan}}<br><strong>Expires:</strong> {{expiry}}</p>
<p style=\"{$p_style}\">If you did not request this change, contact support immediately at {{site_name}}.</p>
{$footer}
</div>",
        ],
    ];

    foreach ($templates as $t) {
        $inserted = $wpdb->insert($table, [
            'slug'      => $t['slug'],
            'label'     => $t['label'],
            'subject'   => $t['subject'],
            'body_html' => $t['body_html'],
            'is_active' => 1,
        ]);
        if (false === $inserted) {
            error_log('pc_seed_email_templates: insert failed for slug=' . $t['slug']);
        }
    }
}

/**
 * Fetch an email template row by slug, or null if not found.
 */
function pc_get_email_template(string $slug): ?array {
    global $wpdb;
    $row = $wpdb->get_row($wpdb->prepare(
        "SELECT * FROM `{$wpdb->prefix}pc_email_templates` WHERE slug = %s LIMIT 1",
        $slug
    ), ARRAY_A);
    return $row ?: null;
}

/**
 * Render a template by slug with variable substitution.
 * Returns [subject, body_html].
 * Falls back to a plain-text version if template is missing or inactive.
 */
function pc_render_template(string $slug, array $vars): array {
    $tpl = pc_get_email_template($slug);
    if (!$tpl || !(int) $tpl['is_active']) {
        // Plain-text fallback
        $subject = 'ProjectCare Notification';
        $body    = "Hello {{email}},\n\nThis is a notification from ProjectCare.\n\n";
        foreach ($vars as $k => $v) $body = str_replace('{{' . $k . '}}', (string) $v, $body);
        return [$subject, $body];
    }

    $subject = $tpl['subject'];
    $body    = $tpl['body_html'];

    // Add standard vars
    $vars['site_name']    = $vars['site_name']    ?? get_bloginfo('name');
    $vars['upgrade_url']  = $vars['upgrade_url']  ?? pc_stripe_link();
    $vars['credits_remaining'] = $vars['credits_remaining']
        ?? (isset($vars['credits_total'], $vars['credits_used'])
            ? max(0, (int) $vars['credits_total'] - (int) $vars['credits_used'])
            : ($vars['credits'] ?? ''));

    foreach ($vars as $k => $v) {
        $subject = str_replace('{{' . $k . '}}', (string) $v, $subject);
        $body    = str_replace('{{' . $k . '}}', (string) $v, $body);
    }

    return [$subject, $body];
}

/**
 * Send an email using a named template, with variable substitution.
 * Logs the send to the activity log. Returns true on success.
 */
function pc_send_email(string $to, string $slug, array $vars): bool {
    [$subject, $body] = pc_render_template($slug, $vars);
    $headers = ['Content-Type: text/html; charset=UTF-8'];
    $sent    = wp_mail($to, $subject, $body, $headers);
    pc_log_activity([
        'email'  => $to,
        'action' => 'email_sent',
        'result' => $sent ? 'success' : 'fail',
        'notes'  => 'template=' . $slug . ' subject=' . mb_substr($subject, 0, 80),
    ]);
    return $sent;
}

/**
 * Send a plain-text admin notification email.
 */
function pc_send_admin_email_notification(string $subject, string $message): void {
    wp_mail(pc_admin_email(), $subject, $message);
}

/**
 * Send credit warning emails using dedup transients.
 */
function pc_maybe_warn(string $email, string $plan, int $remaining, int $total, array $extra_vars = []): void {
    if ($total <= 0) return;
    $pct       = ($remaining / $total) * 100;
    $cache_key = 'pc_warned_' . md5($email);
    $sent_at   = (int) get_transient($cache_key);

    $vars = array_merge([
        'email'           => $email,
        'plan'            => $plan,
        'credits_remaining' => $remaining,
        'credits_total'   => $total,
        'upgrade_url'     => pc_stripe_link(),
    ], $extra_vars);

    if ($remaining <= 0 && $sent_at !== 0) {
        pc_send_email($email, 'exhausted', $vars);
        set_transient($cache_key, 0, 30 * DAY_IN_SECONDS);
    } elseif ($pct <= 10 && $sent_at !== 10 && $sent_at !== 0) {
        pc_send_email($email, 'low_credits_10', $vars);
        set_transient($cache_key, 10, 30 * DAY_IN_SECONDS);
    } elseif ($pct <= 25 && $sent_at === -1) {
        // -1 = never sent (use -1 to distinguish "fresh" from "already sent 25")
        pc_send_email($email, 'low_credits_25', $vars);
        set_transient($cache_key, 25, 30 * DAY_IN_SECONDS);
    }

    // Initialise the transient for a new user so subsequent checks work
    if (get_transient($cache_key) === false) {
        set_transient($cache_key, -1, 30 * DAY_IN_SECONDS);
    }
}
