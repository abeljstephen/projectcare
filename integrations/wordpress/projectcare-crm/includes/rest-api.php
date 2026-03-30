<?php
defined('ABSPATH') || exit;

add_action('rest_api_init', function () {
    $auth = ['permission_callback' => 'pc_check_secret'];

    register_rest_route('projectcare/v1', '/trial',        ['methods' => 'POST', 'callback' => 'pc_rest_trial']        + $auth);
    register_rest_route('projectcare/v1', '/validate',     ['methods' => 'POST', 'callback' => 'pc_rest_validate']     + $auth);
    register_rest_route('projectcare/v1', '/deduct',       ['methods' => 'POST', 'callback' => 'pc_rest_deduct']       + $auth);
    register_rest_route('projectcare/v1', '/quota',        ['methods' => 'POST', 'callback' => 'pc_rest_quota']        + $auth);
    register_rest_route('projectcare/v1', '/stripe',       ['methods' => 'POST', 'callback' => 'pc_stripe_webhook',
        'permission_callback' => '__return_true']);
    register_rest_route('projectcare/v1', '/session/save', ['methods' => 'POST', 'callback' => 'pc_rest_session_save'] + $auth);
    register_rest_route('projectcare/v1', '/session/load', ['methods' => 'POST', 'callback' => 'pc_rest_session_load'] + $auth);
    register_rest_route('projectcare/v1', '/plot-data/save',
        ['methods' => 'POST', 'callback' => 'pc_rest_plot_data_save'] + $auth);
    register_rest_route('projectcare/v1', '/plot-data/(?P<token>[a-f0-9]{32,64})',
        ['methods' => 'GET', 'callback' => 'pc_rest_plot_data_read',
         'permission_callback' => '__return_true']); // token is the bearer — validated inside
});

/**
 * Auth middleware — checks X-Projectcare-Secret header against stored secret.
 */
function pc_check_secret(): bool {
    $header = $_SERVER['HTTP_X_PROJECTCARE_SECRET'] ?? '';
    $secret = pc_secret();
    $result = $secret !== '' && hash_equals($secret, $header);
    if (!$result && $header !== '') {
        error_log('[ProjectCare CRM] Auth failure from ' . pc_get_ip()
            . ' path=' . ($_SERVER['REQUEST_URI'] ?? ''));
    }
    return $result;
}

// ── TRIAL ──────────────────────────────────────────────────────────────────────
function pc_rest_trial(WP_REST_Request $req): WP_REST_Response {
    $trial_max = (int) pc_setting('rl_trial_max', '5');
    if (!pc_rate_limit('trial', max(1, $trial_max), 60)) {
        return rest_ensure_response(['error' => 'Too many requests. Please wait before trying again.']);
    }
    if (!pc_global_rate_limit()) {
        return rest_ensure_response(['error' => 'Service busy. Please try again shortly.']);
    }

    if (pc_setting('trial_paused') === '1') {
        return rest_ensure_response(['error' => 'Trial issuance is temporarily paused. Please check back soon.']);
    }

    $email = strtolower(sanitize_email($req->get_param('email') ?? ''));
    if (!is_email($email)) {
        return rest_ensure_response(['error' => 'A valid email address is required']);
    }

    $promo_code   = sanitize_text_field($req->get_param('promo') ?? '');
    $promo_result = null;
    if ($promo_code !== '' && pc_setting('promos_enabled', '1') === '1') {
        $promo_result = pc_validate_promo($promo_code);
        if (!$promo_result['valid']) {
            return rest_ensure_response(['error' => $promo_result['error']]);
        }
    }

    $existing = pc_get_user_by_email($email);
    if ($existing && !empty($existing->api_key)) {
        return rest_ensure_response([
            'error' => 'A trial was already issued for this email. Check your inbox or subscribe for full access: ' . pc_stripe_link(),
        ]);
    }

    $plan   = 'trial';
    $config = pc_get_plan($plan) ?? ['credits' => 20, 'days' => 10];

    // Apply promo overrides
    if ($promo_result && !empty($promo_result['promo'])) {
        $promo = $promo_result['promo'];
        if (!empty($promo->plan_override)) $plan = $promo->plan_override;
        if ((int) $promo->credits_grant > 0) $config['credits'] = (int) $promo->credits_grant;
        if ((int) $promo->days_override > 0)  $config['days']    = (int) $promo->days_override;
    }

    $key    = bin2hex(random_bytes(32));
    $expiry = date('Y-m-d', strtotime('+' . (int) $config['days'] . ' days'));

    if ($existing) {
        pc_update_user((int) $existing->id, [
            'api_key'       => $key,
            'plan'          => $plan,
            'credits_total' => (int) $config['credits'],
            'credits_used'  => 0,
            'key_expires'   => $expiry,
            'key_status'    => 'active',
            'ip_address'    => pc_get_ip(),
        ]);
        $user_id = (int) $existing->id;
    } else {
        $user_id = (int) pc_create_user([
            'email'         => $email,
            'api_key'       => $key,
            'plan'          => $plan,
            'credits_total' => (int) $config['credits'],
            'credits_used'  => 0,
            'key_expires'   => $expiry,
            'key_status'    => 'active',
            'source'        => 'trial',
            'ip_address'    => pc_get_ip(),
        ]);
    }

    if ($promo_result && !empty($promo_result['promo'])) {
        pc_use_promo((int) $promo_result['promo']->id);
    }

    // Record key in history table (supersede any previous active key first)
    pc_revoke_user_keys($user_id, 'superseded', 'trial re-issued');
    pc_create_api_key($user_id, $email, $key, 'trial issued');

    pc_log_activity([
        'user_id'        => $user_id,
        'email'          => $email,
        'action'         => 'trial_request',
        'operation_type' => 'trial',
        'credits_after'  => (int) $config['credits'],
        'result'         => 'success',
        'ip_address'     => pc_get_ip(),
        'notes'          => 'Trial issued. expires=' . $expiry
            . ($promo_code ? ' promo=' . $promo_code : ''),
    ]);

    pc_send_email($email, 'trial_issued', [
        'email'   => $email,
        'key'     => $key,
        'plan'    => ucfirst($plan),
        'credits' => (int) $config['credits'],
        'expiry'  => $expiry,
    ]);

    if (pc_setting('notify_new_trial', '1') === '1') {
        pc_send_admin_email('PMC Trial Request',
            "New trial\n\nEmail:   {$email}\nExpires: {$expiry}\nCredits: {$config['credits']}"
            . ($promo_code ? "\nPromo:   {$promo_code}" : ''));
    }

    $user = pc_get_user_by_id($user_id);
    if ($user) pc_fluentcrm_sync_user($user, ['trial', 'active']);

    return rest_ensure_response([
        'success' => true,
        'expiry'  => $expiry,
        'credits' => (int) $config['credits'],
        'plan'    => $plan,
        'message' => 'Trial key issued and emailed to ' . $email . '. Check your inbox.',
    ]);
}

// ── VALIDATE ──────────────────────────────────────────────────────────────────
function pc_rest_validate(WP_REST_Request $req): WP_REST_Response {
    $validate_max = (int) pc_setting('rl_validate_max', '30');
    if (!pc_rate_limit('validate', max(1, $validate_max), 60)) {
        pc_log_activity(['action' => 'validate', 'result' => 'rate_limited', 'ip_address' => pc_get_ip()]);
        return rest_ensure_response(['valid' => false, 'error' => 'Too many requests. Please wait before trying again.']);
    }
    if (!pc_global_rate_limit()) {
        return rest_ensure_response(['valid' => false, 'error' => 'Service busy. Please try again shortly.']);
    }

    $key = sanitize_text_field($req->get_param('key') ?? '');
    if (strlen($key) > 256) {
        return rest_ensure_response(['valid' => false, 'error' => 'Invalid key']);
    }

    $user = pc_get_user_by_key($key);
    if (!$user) {
        // Check if key exists in history (superseded/revoked) for a better message
        global $wpdb;
        $hist = $wpdb->get_row($wpdb->prepare(
            "SELECT k.status, u.email FROM `{$wpdb->prefix}pc_api_keys` k
             JOIN `{$wpdb->prefix}pc_users` u ON u.id = k.user_id
             WHERE k.api_key = %s LIMIT 1",
            $key
        ));
        if ($hist) {
            pc_log_activity(['action' => 'validate', 'result' => 'fail', 'ip_address' => pc_get_ip(),
                'email' => $hist->email, 'notes' => 'key ' . $hist->status]);
            $msg = $hist->status === 'superseded'
                ? 'This key has been replaced. Check your inbox for your latest key.'
                : 'This key has been revoked. Subscribe for access.';
            return rest_ensure_response(['valid' => false, 'error' => $msg, 'upgrade_url' => pc_stripe_link()]);
        }
        error_log('[ProjectCare CRM] Invalid key attempt from ' . pc_get_ip());
        pc_log_activity(['action' => 'validate', 'result' => 'fail', 'ip_address' => pc_get_ip(), 'notes' => 'invalid key']);
        return rest_ensure_response(['valid' => false, 'error' => 'Invalid key']);
    }

    $status    = $user->key_status;
    $expiry    = $user->key_expires;
    $total     = (int) $user->credits_total;
    $used      = max(0, (int) $user->credits_used);
    $remaining = $total - $used;

    if ($status !== 'active') {
        pc_log_activity(['user_id' => (int) $user->id, 'email' => $user->email,
            'action' => 'validate', 'result' => 'fail', 'ip_address' => pc_get_ip(),
            'notes'  => 'key status=' . $status]);
        return rest_ensure_response(['valid' => false,
            'error'       => 'Key inactive. Subscribe for access.',
            'upgrade_url' => pc_stripe_link()]);
    }

    $expiry_ts = $expiry ? strtotime($expiry) : false;
    if ($expiry_ts === false || $expiry_ts < time()) {
        pc_update_user((int) $user->id, ['key_status' => 'expired']);
        pc_log_activity(['user_id' => (int) $user->id, 'email' => $user->email,
            'action' => 'validate', 'result' => 'fail', 'ip_address' => pc_get_ip(),
            'notes'  => 'key expired on ' . $expiry]);
        return rest_ensure_response(['valid' => false,
            'error'       => 'Key inactive. Subscribe for access.',
            'upgrade_url' => pc_stripe_link()]);
    }

    if ($remaining <= 0) {
        pc_log_activity(['user_id' => (int) $user->id, 'email' => $user->email,
            'action' => 'validate', 'result' => 'fail', 'ip_address' => pc_get_ip(),
            'notes'  => 'quota exhausted']);
        return rest_ensure_response(['valid' => false,
            'error'       => 'Quota exhausted — no credits remaining.',
            'upgrade_url' => pc_stripe_link()]);
    }

    pc_log_activity(['user_id' => (int) $user->id, 'email' => $user->email,
        'action' => 'validate', 'result' => 'success', 'ip_address' => pc_get_ip(),
        'credits_before' => $total, 'credits_after' => $remaining]);

    $plan_row    = pc_get_plan($user->plan);
    $gas_tier    = isset($plan_row['gas_tier']) ? $plan_row['gas_tier'] : 'full';
    $credit_costs = pc_get_credit_costs();

    return rest_ensure_response([
        'valid'        => true,
        'email'        => $user->email,
        'plan'         => $user->plan,
        'gas_tier'     => $gas_tier,
        'credit_costs' => $credit_costs,
        'total'        => $total,
        'used'         => $used,
        'remaining'    => $remaining,
        'expires'      => $expiry,
        'bar'          => pc_bar($used, $total),
    ]);
}

// ── GEO LOOKUP ────────────────────────────────────────────────────────────────
/**
 * Resolve IP → country + region via ip-api.com (free, no key required).
 * Results cached 24 h per IP using WordPress transients.
 * Returns ['country' => 'US', 'region' => 'California'] or empty strings on failure.
 */
function pc_geo_lookup(string $ip): array {
    if (empty($ip) || in_array($ip, ['127.0.0.1', '::1'], true)) {
        return ['country' => '', 'region' => ''];
    }
    $cache_key = 'pc_geo_' . md5($ip);
    $cached    = get_transient($cache_key);
    if ($cached !== false) return $cached;

    $resp = wp_remote_get(
        'http://ip-api.com/json/' . rawurlencode($ip) . '?fields=status,countryCode,regionName',
        ['timeout' => 3, 'sslverify' => true]
    );
    $geo = ['country' => '', 'region' => ''];
    if (!is_wp_error($resp) && wp_remote_retrieve_response_code($resp) === 200) {
        $data = json_decode(wp_remote_retrieve_body($resp), true);
        if (is_array($data) && ($data['status'] ?? '') === 'success') {
            $geo = [
                'country' => substr(sanitize_text_field($data['countryCode'] ?? ''), 0, 8),
                'region'  => substr(sanitize_text_field($data['regionName']  ?? ''), 0, 64),
            ];
        }
    }
    set_transient($cache_key, $geo, DAY_IN_SECONDS);
    return $geo;
}

// ── DEDUCT ────────────────────────────────────────────────────────────────────
function pc_rest_deduct(WP_REST_Request $req): WP_REST_Response {
    $key = sanitize_text_field($req->get_param('key') ?? '');
    if (strlen($key) > 256) return rest_ensure_response(['error' => 'Invalid key']);

    $cost            = max(1, (int) ($req->get_param('cost')            ?? 2));
    $operation       = sanitize_text_field($req->get_param('operation')   ?? 'estimation');
    $duration_ms     = (int) ($req->get_param('duration_ms')      ?? 0);
    $gas_count       = (int) ($req->get_param('gas_exec_count')   ?? 0);
    $task_count      = max(0, (int) ($req->get_param('task_count')      ?? 0));
    $has_sliders     = (int) ($req->get_param('has_sliders')      ?? 0) ? 1 : 0;
    $feasibility_avg = round((float) ($req->get_param('feasibility_avg') ?? 0), 2);
    if (strlen($operation) > 64) $operation = 'estimation';

    $ip  = pc_get_ip();
    $geo = pc_geo_lookup($ip);

    $user = pc_get_user_by_key($key);
    if (!$user) {
        error_log('[ProjectCare CRM] Deduct with invalid key from ' . $ip);
        return rest_ensure_response(['error' => 'Invalid key']);
    }

    $total     = (int) $user->credits_total;
    $used      = max(0, (int) $user->credits_used);
    $new_used  = $used + $cost;
    $remaining = max(0, $total - $new_used);

    pc_update_user((int) $user->id, [
        'credits_used'    => $new_used,
        'last_estimation' => current_time('mysql'),
    ]);

    pc_log_activity([
        'user_id'         => (int) $user->id,
        'email'           => $user->email,
        'action'          => 'deduct',
        'operation_type'  => $operation,
        'credits_cost'    => $cost,
        'credits_before'  => $total - $used,
        'credits_after'   => $remaining,
        'duration_ms'     => $duration_ms,
        'gas_exec_count'  => $gas_count,
        'task_count'      => $task_count,
        'has_sliders'     => $has_sliders,
        'feasibility_avg' => $feasibility_avg,
        'geo_country'     => $geo['country'],
        'geo_region'      => $geo['region'],
        'ip_address'      => $ip,
        'result'          => 'success',
        'notes'           => ucfirst($operation) . ' — ' . $cost . ' credit(s). Remaining: ' . $remaining . '/' . $total,
    ]);

    pc_maybe_warn($user->email, $user->plan, $remaining, $total);
    pc_fluentcrm_sync_user(pc_get_user_by_id((int) $user->id) ?? $user);

    return rest_ensure_response([
        'success'   => true,
        'used'      => $new_used,
        'remaining' => $remaining,
        'total'     => $total,
        'bar'       => pc_bar($new_used, $total),
    ]);
}

// ── QUOTA ─────────────────────────────────────────────────────────────────────
function pc_rest_quota(WP_REST_Request $req): WP_REST_Response {
    $key = sanitize_text_field($req->get_param('key') ?? '');
    if (strlen($key) > 256) return rest_ensure_response(['error' => 'Invalid key']);

    $user = pc_get_user_by_key($key);
    if (!$user) return rest_ensure_response(['error' => 'Invalid key']);

    $total     = (int) $user->credits_total;
    $used      = (int) $user->credits_used;
    $remaining = max(0, $total - $used);

    return rest_ensure_response([
        'plan'      => $user->plan,
        'total'     => $total,
        'used'      => $used,
        'remaining' => $remaining,
        'expires'   => $user->key_expires,
        'status'    => $user->key_status,
        'bar'       => pc_bar($used, $total),
        'last_used' => $user->last_estimation ?: 'Never',
    ]);
}

// ── SESSION SAVE ──────────────────────────────────────────────────────────────
function pc_rest_session_save(WP_REST_Request $req): WP_REST_Response {
    if (pc_setting('sessions_enabled', '1') !== '1') {
        return rest_ensure_response(['error' => 'Session storage is disabled.']);
    }
    $session_max = (int) pc_setting('rl_session_max', '20');
    if (!pc_rate_limit('session', max(1, $session_max), 60)) {
        return rest_ensure_response(['error' => 'Too many requests. Please wait before trying again.']);
    }

    $key     = sanitize_text_field($req->get_param('key')   ?? '');
    $email   = strtolower(sanitize_email($req->get_param('email') ?? ''));
    $session = $req->get_param('session');

    if (strlen($key) > 256)  return rest_ensure_response(['error' => 'Invalid key']);
    if (!is_email($email))   return rest_ensure_response(['error' => 'A valid email address is required']);
    if (!is_array($session) && !is_object($session)) {
        return rest_ensure_response(['error' => 'session must be a JSON object']);
    }

    $user = pc_get_user_by_key($key);
    if (!$user) return rest_ensure_response(['error' => 'Invalid key']);
    if (strtolower($user->email) !== $email) {
        return rest_ensure_response(['error' => 'Email does not match key']);
    }

    $session_json = wp_json_encode($session);
    if (strlen($session_json) > 50000) {
        return rest_ensure_response(['error' => 'Session data too large (max 50 KB)']);
    }

    $session_id = 'sess_' . time() . '_' . bin2hex(random_bytes(4));
    $saved_at   = current_time('mysql');

    $envelope = [
        'session_id' => $session_id,
        'saved_at'   => $saved_at,
        'project'    => is_array($session) ? sanitize_text_field($session['project'] ?? '') : '',
        'task_count' => is_array($session) && isset($session['tasks']) && is_array($session['tasks'])
                        ? count($session['tasks']) : 0,
        'data'       => $session,
    ];

    pc_log_activity([
        'user_id' => (int) $user->id,
        'email'   => $email,
        'action'  => 'session_save',
        'result'  => 'success',
        'notes'   => wp_json_encode($envelope),
    ]);

    // Prune: keep last 10 session_save entries per user
    global $wpdb;
    $table    = $wpdb->prefix . 'pc_activity';
    $all_ids  = $wpdb->get_col($wpdb->prepare(
        "SELECT id FROM `{$table}` WHERE user_id = %d AND action = 'session_save' ORDER BY created_at DESC",
        (int) $user->id
    ));
    if (count($all_ids) > 10) {
        $to_delete = array_slice($all_ids, 10);
        $placeholders = implode(',', array_fill(0, count($to_delete), '%d'));
        $wpdb->query($wpdb->prepare(
            "DELETE FROM `{$table}` WHERE id IN ({$placeholders})",
            ...$to_delete
        ));
    }

    return rest_ensure_response([
        'success'    => true,
        'session_id' => $session_id,
        'saved_at'   => $saved_at,
    ]);
}

// ── SESSION LOAD ──────────────────────────────────────────────────────────────
function pc_rest_session_load(WP_REST_Request $req): WP_REST_Response {
    if (pc_setting('sessions_enabled', '1') !== '1') {
        return rest_ensure_response(['error' => 'Session storage is disabled.']);
    }
    $session_max = (int) pc_setting('rl_session_max', '20');
    if (!pc_rate_limit('session', max(1, $session_max), 60)) {
        return rest_ensure_response(['error' => 'Too many requests. Please wait before trying again.']);
    }

    $key   = sanitize_text_field($req->get_param('key')   ?? '');
    $email = strtolower(sanitize_email($req->get_param('email') ?? ''));

    if (strlen($key) > 256) return rest_ensure_response(['error' => 'Invalid key']);
    if (!is_email($email))  return rest_ensure_response(['error' => 'A valid email address is required']);

    $user = pc_get_user_by_key($key);
    if (!$user) return rest_ensure_response(['error' => 'Invalid key']);
    if (strtolower($user->email) !== $email) {
        return rest_ensure_response(['error' => 'Email does not match key']);
    }

    global $wpdb;
    $table = $wpdb->prefix . 'pc_activity';
    $rows  = $wpdb->get_results($wpdb->prepare(
        "SELECT notes, created_at FROM `{$table}`
         WHERE user_id = %d AND action = 'session_save'
         ORDER BY created_at DESC LIMIT 5",
        (int) $user->id
    )) ?: [];

    $sessions = [];
    foreach ($rows as $row) {
        $env = json_decode($row->notes, true);
        if (!is_array($env)) continue;
        $sessions[] = [
            'session_id' => $env['session_id'] ?? '',
            'saved_at'   => $env['saved_at']   ?? $row->created_at,
            'project'    => $env['project']    ?? '',
            'task_count' => $env['task_count'] ?? 0,
        ];
    }

    return rest_ensure_response([
        'success'  => true,
        'sessions' => $sessions,
        'count'    => count($sessions),
    ]);
}

// ── PLOT DATA SAVE ─────────────────────────────────────────────────────────────
// Called by GAS after each call_api. Upserts full distribution data by token.
// Auth: X-Projectcare-Secret (server-to-server from GAS only).
function pc_rest_plot_data_save(WP_REST_Request $req): WP_REST_Response {
    $token = sanitize_text_field($req->get_param('token') ?? '');
    if (!preg_match('/^[a-f0-9]{32,64}$/', $token)) {
        return rest_ensure_response(['error' => 'Invalid token format']);
    }

    $data = $req->get_param('data');
    if (!is_array($data) && !is_object($data)) {
        return rest_ensure_response(['error' => 'data must be a JSON object']);
    }

    $json = wp_json_encode($data);
    if (strlen($json) > 204800) { // 200 KB limit
        return rest_ensure_response(['error' => 'Plot data too large (max 200 KB)']);
    }

    global $wpdb;
    $table    = $wpdb->prefix . 'pc_plot_data';
    $saved_at = current_time('mysql');

    $result = $wpdb->query($wpdb->prepare(
        "INSERT INTO `{$table}` (token, data, saved_at, created_at)
         VALUES (%s, %s, %s, %s)
         ON DUPLICATE KEY UPDATE data = VALUES(data), saved_at = VALUES(saved_at)",
        $token, $json, $saved_at, $saved_at
    ));

    if ($result === false) {
        error_log('[ProjectCare CRM] plot_data save failed: ' . $wpdb->last_error);
        return rest_ensure_response(['error' => 'Storage error']);
    }

    return rest_ensure_response(['success' => true, 'token' => $token, 'saved_at' => $saved_at]);
}

// ── PLOT DATA READ ─────────────────────────────────────────────────────────────
// GET — called by plot.html / cpm.html polling loop.
// Token acts as a bearer credential: 32–64 hex chars, max age 2 hours.
// Expired or unknown tokens return {"status":"not_found"} (no distinguishable error).
// CORS restricted to GitHub Pages origin only.
const PC_PLOT_TTL_SECONDS = 7200; // 2 hours

function pc_rest_plot_data_read(WP_REST_Request $req): WP_REST_Response {
    $token = sanitize_text_field($req->get_param('token') ?? '');

    // Validate token format — reject malformed tokens immediately
    if (!preg_match('/^[a-f0-9]{32,64}$/', $token)) {
        return pc_plot_not_found();
    }

    // Rate-limit the read endpoint — max 60 reads/minute per IP
    // (prevents token enumeration via rapid-fire polling)
    $ip       = pc_get_ip();
    $rl_key   = 'pc_pdr_' . md5($ip);
    $rl_count = (int) get_transient($rl_key);
    if ($rl_count >= 60) {
        return pc_plot_not_found();
    }
    set_transient($rl_key, $rl_count + 1, 60);

    global $wpdb;
    $table = $wpdb->prefix . 'pc_plot_data';
    $row   = $wpdb->get_row($wpdb->prepare(
        "SELECT data, saved_at, created_at FROM `{$table}` WHERE token = %s LIMIT 1",
        $token
    ));

    // Not found
    if (!$row) {
        return pc_plot_not_found();
    }

    // TTL check — reject if session is older than PC_PLOT_TTL_SECONDS
    $age = time() - strtotime($row->created_at);
    if ($age > PC_PLOT_TTL_SECONDS) {
        // Clean up expired row
        $wpdb->delete($table, ['token' => $token], ['%s']);
        return pc_plot_not_found();
    }

    $response = rest_ensure_response([
        'data'     => json_decode($row->data, true),
        'saved_at' => $row->saved_at,
    ]);

    // CORS restricted to GitHub Pages only — no wildcard
    $response->header('Access-Control-Allow-Origin', 'https://abeljstephen.github.io');
    $response->header('Access-Control-Allow-Methods', 'GET');
    $response->header('Cache-Control', 'no-store, no-cache, must-revalidate');
    $response->header('Vary', 'Origin');

    return $response;
}

function pc_plot_not_found(): WP_REST_Response {
    $r = rest_ensure_response(['status' => 'not_found']);
    $r->header('Cache-Control', 'no-store');
    return $r;
}

// NOTE: GPT proxy removed — GoDaddy blocks outbound SSL to script.google.com.
// GPT calls GAS directly via openapi.yaml. If hosting changes, proxy can be re-added.
