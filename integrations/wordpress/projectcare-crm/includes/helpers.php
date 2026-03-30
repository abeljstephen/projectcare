<?php
defined('ABSPATH') || exit;

function pc_setting(string $key, string $default = ''): string {
    return (string) get_option('pc_' . $key, $default);
}

function pc_secret(): string      { return pc_setting('api_secret'); }
function pc_stripe_hook(): string { return pc_setting('stripe_hook_secret'); }
function pc_stripe_link(): string { return pc_setting('stripe_link', 'https://buy.stripe.com/YOUR_LINK'); }
function pc_admin_email(): string { return pc_setting('admin_email', get_option('admin_email')); }

/**
 * Visual credit usage bar.
 * Example: ████████░░░░░░░░░░░░  40% remaining (12/20 credits)
 */
function pc_bar(int $used, int $total): string {
    if ($total <= 0) return '░░░░░░░░░░░░░░░░░░░░  0% remaining (0/0 credits)';
    $pct      = min(100, (int) round(($used / $total) * 100));
    $filled   = (int) round($pct / 5);
    $remaining_pct = 100 - $pct;
    $remaining     = max(0, $total - $used);
    return str_repeat('█', $filled) . str_repeat('░', 20 - $filled)
        . '  ' . $remaining_pct . '% remaining (' . $remaining . '/' . $total . ' credits)';
}

/**
 * Admin tooltip HTML span.
 */
function pc_tip(string $text): string {
    return '<span class="pmc-tip" title="' . esc_attr($text) . '" '
        . 'style="cursor:help;color:#2271b1;font-size:11px;margin-left:4px">(?)</span>';
}

/**
 * Verify a Stripe webhook signature using HMAC-SHA256.
 */
function pc_verify_stripe(string $payload, string $sig_header, string $secret): bool {
    if (empty($secret) || empty($sig_header)) return false;
    $parts = [];
    foreach (explode(',', $sig_header) as $part) {
        $kv = explode('=', $part, 2);
        if (count($kv) === 2) $parts[$kv[0]] = $kv[1];
    }
    if (empty($parts['t']) || empty($parts['v1'])) return false;
    $expected = hash_hmac('sha256', $parts['t'] . '.' . $payload, $secret);
    return hash_equals($expected, $parts['v1']);
}

/**
 * Map a Stripe payment amount (in dollars) to a plan slug.
 */
function pc_amount_to_plan(float $amount): string {
    $plans = pc_get_plans();
    // Remove trial; sort highest price first
    $paid = array_filter($plans, fn($p) => $p['slug'] !== 'trial');
    usort($paid, fn($a, $b) => $b['price_min_cents'] - $a['price_min_cents']);
    foreach ($paid as $plan) {
        if ($amount * 100 >= $plan['price_min_cents']) return $plan['slug'];
    }
    return 'starter';
}

/**
 * Map a Stripe payment amount (in dollars) to a top-up credit pack size.
 */
function pc_amount_to_topup(float $amount): int {
    foreach (pc_topup_packs() as $pack) {
        if ($amount >= $pack['price_min']) return $pack['credits'];
    }
    return 50;
}

/**
 * Send a plain-text admin notification email.
 */
function pc_send_admin_email(string $subject, string $message): void {
    wp_mail(pc_admin_email(), $subject, $message);
}

/**
 * Relative time string.
 */
function pc_relative_time(?string $datetime): string {
    if (!$datetime) return 'Never';
    $ts = strtotime($datetime);
    if ($ts === false) return 'Never';
    $diff = time() - $ts;
    if ($diff <    60) return 'Just now';
    if ($diff <  3600) return round($diff / 60) . 'm ago';
    if ($diff < 86400) return round($diff / 3600) . 'h ago';
    if ($diff < 86400 * 7) return round($diff / 86400) . 'd ago';
    return date('M j, Y', $ts);
}

/**
 * Status pill badge HTML.
 */
function pc_status_badge(string $status, bool $expired = false): string {
    if ($expired && $status === 'active') $status = 'expired';
    $styles = [
        'active'     => 'background:#d1fae5;color:#065f46',
        'expired'    => 'background:#fee2e2;color:#991b1b',
        'suspended'  => 'background:#fef3c7;color:#92400e',
        'inactive'   => 'background:#f3f4f6;color:#374151',
        'cancelled'  => 'background:#f3f4f6;color:#374151',
        'superseded' => 'background:#f3f4f6;color:#374151',
    ];
    $s = $styles[$status] ?? 'background:#f3f4f6;color:#374151';
    return '<span style="' . $s . ';padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;text-transform:uppercase;white-space:nowrap">'
        . esc_html($status) . '</span>';
}

/**
 * Plan pill badge HTML.
 */
function pc_plan_badge(string $plan): string {
    $styles = [
        'trial'        => 'background:#dbeafe;color:#1e40af',
        'starter'      => 'background:#d1fae5;color:#065f46',
        'professional' => 'background:#ede9fe;color:#4c1d95',
        'team'         => 'background:#fef3c7;color:#78350f',
        'enterprise'   => 'background:#fee2e2;color:#7f1d1d',
    ];
    $s = $styles[$plan] ?? 'background:#f3f4f6;color:#374151';
    return '<span style="' . $s . ';padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;white-space:nowrap">'
        . esc_html(ucfirst($plan)) . '</span>';
}

/**
 * Inline credit progress bar HTML for table cells.
 */
function pc_credits_bar_html(int $used, int $total): string {
    if ($total <= 0) return '<span style="color:#999;font-size:12px">—</span>';
    $remaining = max(0, $total - $used);
    $pct       = min(100, (int) round($remaining / $total * 100));
    $color     = $pct <= 0 ? '#b32d2e' : ($pct < 10 ? '#c05600' : ($pct < 25 ? '#f0a500' : '#0a6b0a'));
    return '<div style="min-width:90px">'
        . '<div style="height:5px;background:#e5e7eb;border-radius:3px;overflow:hidden;margin-bottom:3px">'
        . '<div style="height:100%;width:' . $pct . '%;background:' . esc_attr($color) . ';border-radius:3px"></div>'
        . '</div>'
        . '<span style="font-size:11px;color:' . esc_attr($color) . ';font-weight:600">'
        . esc_html($remaining . '/' . $total) . '</span>'
        . '</div>';
}

/**
 * Paginate with prev/next and ellipsis. Returns HTML string.
 *
 * @param array  $params     Query params to preserve (no 'page' key, no 'paged').
 * @param string $base_url   URL with page=pmc-crm-* already included.
 */
function pc_build_pagination(int $current, int $total_pages, array $params, string $base_url): string {
    if ($total_pages <= 1) return '';
    $links = [];

    $prev_url = add_query_arg(array_merge($params, ['paged' => $current - 1]), $base_url);
    $next_url = add_query_arg(array_merge($params, ['paged' => $current + 1]), $base_url);

    if ($current > 1) {
        $links[] = '<a href="' . esc_url($prev_url) . '" class="button">&lsaquo; Prev</a>';
    } else {
        $links[] = '<span class="button" style="opacity:.4;cursor:default">&lsaquo; Prev</span>';
    }

    $range = 2;
    $shown = [];
    for ($i = 1; $i <= $total_pages; $i++) {
        if ($i === 1 || $i === $total_pages || abs($i - $current) <= $range) $shown[] = $i;
    }

    $prev_n = null;
    foreach ($shown as $n) {
        if ($prev_n !== null && $n - $prev_n > 1) {
            $links[] = '<span style="padding:0 4px;color:#666;line-height:28px">…</span>';
        }
        if ($n === $current) {
            $links[] = '<span class="button button-primary" style="cursor:default">' . $n . '</span>';
        } else {
            $url = add_query_arg(array_merge($params, ['paged' => $n]), $base_url);
            $links[] = '<a href="' . esc_url($url) . '" class="button">' . $n . '</a>';
        }
        $prev_n = $n;
    }

    if ($current < $total_pages) {
        $links[] = '<a href="' . esc_url($next_url) . '" class="button">Next &rsaquo;</a>';
    } else {
        $links[] = '<span class="button" style="opacity:.4;cursor:default">Next &rsaquo;</span>';
    }

    return '<div style="display:flex;align-items:center;gap:3px;flex-wrap:wrap">' . implode('', $links) . '</div>';
}
