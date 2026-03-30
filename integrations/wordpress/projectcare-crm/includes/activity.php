<?php
defined('ABSPATH') || exit;

/**
 * Insert an activity log entry.
 *
 * Accepted fields: user_id, email, action, operation_type, credits_cost,
 * credits_before, credits_after, duration_ms, gas_exec_count, task_count,
 * has_sliders, feasibility_avg, geo_country, geo_region, ip_address,
 * result, notes.
 */
function pc_log_activity(array $data): void {
    global $wpdb;
    $row = [
        'user_id'         => (int)    ($data['user_id']         ?? 0),
        'email'           => strtolower((string) ($data['email'] ?? '')),
        'action'          => (string) ($data['action']          ?? ''),
        'operation_type'  => (string) ($data['operation_type']  ?? ''),
        'credits_cost'    => (int)    ($data['credits_cost']    ?? 0),
        'credits_before'  => (int)    ($data['credits_before']  ?? 0),
        'credits_after'   => (int)    ($data['credits_after']   ?? 0),
        'duration_ms'     => (int)    ($data['duration_ms']     ?? 0),
        'gas_exec_count'  => (int)    ($data['gas_exec_count']  ?? 0),
        'task_count'      => (int)    ($data['task_count']      ?? 0),
        'has_sliders'     => (int)    ($data['has_sliders']     ?? 0) ? 1 : 0,
        'feasibility_avg' => round((float) ($data['feasibility_avg'] ?? 0), 2),
        'geo_country'     => substr((string) ($data['geo_country'] ?? ''), 0, 8),
        'geo_region'      => substr((string) ($data['geo_region']  ?? ''), 0, 64),
        'ip_address'      => (string) ($data['ip_address']      ?? pc_get_ip()),
        'result'          => (string) ($data['result']          ?? 'success'),
        'notes'           => isset($data['notes']) ? (string) $data['notes'] : null,
        'created_at'      => current_time('mysql'),
    ];
    $result = $wpdb->insert($wpdb->prefix . 'pc_activity', $row);
    if (false === $result) {
        error_log('pc_log_activity: DB insert failed for action=' . $row['action']);
    }
}

/**
 * Fetch activity rows with optional filters.
 *
 * Supported filters: user_id, email, action, result, date_from, date_to, ip_address.
 */
function pc_get_activity(array $filters = [], int $limit = 50, int $offset = 0): array {
    global $wpdb;
    $table = $wpdb->prefix . 'pc_activity';
    [$where, $vals] = _pc_activity_where($filters);

    $sql = "SELECT * FROM `{$table}` WHERE " . implode(' AND ', $where)
        . " ORDER BY created_at DESC LIMIT %d OFFSET %d";
    $vals[] = $limit;
    $vals[] = $offset;

    return $wpdb->get_results($wpdb->prepare($sql, ...$vals)) ?: [];
}

/**
 * Count activity rows matching filters.
 */
function pc_get_activity_count(array $filters = []): int {
    global $wpdb;
    $table = $wpdb->prefix . 'pc_activity';
    [$where, $vals] = _pc_activity_where($filters);
    $sql = "SELECT COUNT(*) FROM `{$table}` WHERE " . implode(' AND ', $where);
    if (!empty($vals)) {
        return (int) $wpdb->get_var($wpdb->prepare($sql, ...$vals));
    }
    return (int) $wpdb->get_var($sql);
}

/** Build WHERE clauses for activity queries (internal helper). */
function _pc_activity_where(array $filters): array {
    $where = ['1=1'];
    $vals  = [];
    if (!empty($filters['user_id'])) {
        $where[] = 'user_id = %d';
        $vals[]  = (int) $filters['user_id'];
    }
    if (!empty($filters['email'])) {
        $where[] = 'email LIKE %s';
        global $wpdb;
        $vals[]  = '%' . $wpdb->esc_like(strtolower($filters['email'])) . '%';
    }
    if (!empty($filters['action'])) {
        $where[] = 'action = %s';
        $vals[]  = $filters['action'];
    }
    if (!empty($filters['result'])) {
        $where[] = 'result = %s';
        $vals[]  = $filters['result'];
    }
    if (!empty($filters['date_from'])) {
        $where[] = 'created_at >= %s';
        $vals[]  = $filters['date_from'] . ' 00:00:00';
    }
    if (!empty($filters['date_to'])) {
        $where[] = 'created_at <= %s';
        $vals[]  = $filters['date_to'] . ' 23:59:59';
    }
    if (!empty($filters['ip_address'])) {
        global $wpdb;
        $where[] = 'ip_address LIKE %s';
        $vals[]  = '%' . $wpdb->esc_like($filters['ip_address']) . '%';
    }
    return [$where, $vals];
}

/**
 * Aggregate call statistics for a time window.
 *
 * Returns: total_calls, total_duration_ms, avg_duration_ms, failed_calls,
 *          unique_users, credits_consumed, calls_by_day, calls_by_hour, top_users.
 */
function pc_get_calls_in_window(string $from_date, string $to_date): array {
    global $wpdb;
    $table = $wpdb->prefix . 'pc_activity';
    $from  = $from_date . ' 00:00:00';
    $to    = $to_date . ' 23:59:59';

    $totals = $wpdb->get_row($wpdb->prepare(
        "SELECT
            COUNT(*) AS total_calls,
            COALESCE(SUM(duration_ms), 0) AS total_duration_ms,
            COALESCE(AVG(duration_ms), 0) AS avg_duration_ms,
            SUM(result != 'success') AS failed_calls,
            COUNT(DISTINCT email) AS unique_users,
            COALESCE(SUM(credits_cost), 0) AS credits_consumed
         FROM `{$table}`
         WHERE action IN ('validate','deduct','trial_request')
           AND created_at BETWEEN %s AND %s",
        $from, $to
    ), ARRAY_A);

    $by_day_rows = $wpdb->get_results($wpdb->prepare(
        "SELECT DATE(created_at) AS day, COUNT(*) AS cnt
         FROM `{$table}` WHERE action IN ('validate','deduct')
           AND created_at BETWEEN %s AND %s
         GROUP BY day ORDER BY day ASC",
        $from, $to
    ), ARRAY_A) ?: [];
    $calls_by_day = [];
    foreach ($by_day_rows as $r) $calls_by_day[$r['day']] = (int) $r['cnt'];

    $by_hour_rows = $wpdb->get_results($wpdb->prepare(
        "SELECT HOUR(created_at) AS hr, COUNT(*) AS cnt
         FROM `{$table}` WHERE action IN ('validate','deduct')
           AND created_at BETWEEN %s AND %s
         GROUP BY hr ORDER BY hr ASC",
        $from, $to
    ), ARRAY_A) ?: [];
    $calls_by_hour = array_fill(0, 24, 0);
    foreach ($by_hour_rows as $r) $calls_by_hour[(int) $r['hr']] = (int) $r['cnt'];

    $top_user_rows = $wpdb->get_results($wpdb->prepare(
        "SELECT email, COUNT(*) AS cnt
         FROM `{$table}` WHERE action IN ('validate','deduct')
           AND created_at BETWEEN %s AND %s AND email != ''
         GROUP BY email ORDER BY cnt DESC LIMIT 5",
        $from, $to
    ), ARRAY_A) ?: [];
    $top_users = [];
    foreach ($top_user_rows as $r) $top_users[$r['email']] = (int) $r['cnt'];

    return [
        'total_calls'       => (int)   ($totals['total_calls']       ?? 0),
        'total_duration_ms' => (int)   ($totals['total_duration_ms'] ?? 0),
        'avg_duration_ms'   => (float) ($totals['avg_duration_ms']   ?? 0),
        'failed_calls'      => (int)   ($totals['failed_calls']      ?? 0),
        'unique_users'      => (int)   ($totals['unique_users']      ?? 0),
        'credits_consumed'  => (int)   ($totals['credits_consumed']  ?? 0),
        'calls_by_day'      => $calls_by_day,
        'calls_by_hour'     => $calls_by_hour,
        'top_users'         => $top_users,
    ];
}

/**
 * Return daily stats for chart rendering.
 * Returns array of [date, calls, duration_ms, credits].
 */
function pc_get_daily_stats(int $days_back = 30): array {
    global $wpdb;
    $table = $wpdb->prefix . 'pc_activity';
    $from  = date('Y-m-d', strtotime("-{$days_back} days")) . ' 00:00:00';
    $to    = date('Y-m-d') . ' 23:59:59';

    $rows = $wpdb->get_results($wpdb->prepare(
        "SELECT DATE(created_at) AS date,
                COUNT(*) AS calls,
                COALESCE(SUM(duration_ms), 0) AS duration_ms,
                COALESCE(SUM(credits_cost), 0) AS credits
         FROM `{$table}`
         WHERE action IN ('validate','deduct')
           AND created_at BETWEEN %s AND %s
         GROUP BY DATE(created_at) ORDER BY date ASC",
        $from, $to
    ), ARRAY_A) ?: [];

    $result = [];
    foreach ($rows as $r) {
        $result[] = [
            'date'        => $r['date'],
            'calls'       => (int)   $r['calls'],
            'duration_ms' => (int)   $r['duration_ms'],
            'credits'     => (int)   $r['credits'],
        ];
    }
    return $result;
}

/**
 * Return the peak day (most calls) in a date range.
 * Returns [date, count].
 */
function pc_get_peak_day(string $from, string $to): array {
    global $wpdb;
    $table = $wpdb->prefix . 'pc_activity';
    $row = $wpdb->get_row($wpdb->prepare(
        "SELECT DATE(created_at) AS date, COUNT(*) AS cnt
         FROM `{$table}`
         WHERE action IN ('validate','deduct')
           AND created_at BETWEEN %s AND %s
         GROUP BY DATE(created_at) ORDER BY cnt DESC LIMIT 1",
        $from . ' 00:00:00', $to . ' 23:59:59'
    ), ARRAY_A);
    if (!$row) return ['date' => '—', 'count' => 0];
    return ['date' => $row['date'], 'count' => (int) $row['cnt']];
}

/**
 * Count validate actions with no corresponding deduct in the past N minutes.
 * Proxy for GAS execution errors.
 */
function pc_get_failed_unmatched_validates(int $minutes = 60): int {
    global $wpdb;
    $table = $wpdb->prefix . 'pc_activity';
    $since = date('Y-m-d H:i:s', strtotime("-{$minutes} minutes"));
    return (int) $wpdb->get_var($wpdb->prepare(
        "SELECT COUNT(*) FROM `{$table}`
         WHERE action = 'validate' AND result != 'success' AND created_at >= %s",
        $since
    ));
}

/**
 * Delete activity rows older than N days. Returns count deleted.
 */
function pc_prune_activity(int $older_than_days): int {
    global $wpdb;
    $table    = $wpdb->prefix . 'pc_activity';
    $cutoff   = date('Y-m-d H:i:s', strtotime("-{$older_than_days} days"));
    $affected = $wpdb->query($wpdb->prepare(
        "DELETE FROM `{$table}` WHERE created_at < %s",
        $cutoff
    ));
    return (int) $affected;
}
