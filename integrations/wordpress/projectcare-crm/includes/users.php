<?php
defined('ABSPATH') || exit;

function pc_get_user_by_email(string $email): ?object {
    global $wpdb;
    $row = $wpdb->get_row($wpdb->prepare(
        "SELECT * FROM `{$wpdb->prefix}pc_users` WHERE email = %s LIMIT 1",
        strtolower($email)
    ));
    return $row ?: null;
}

function pc_get_user_by_key(string $key): ?object {
    if (empty($key)) return null;
    global $wpdb;
    $row = $wpdb->get_row($wpdb->prepare(
        "SELECT * FROM `{$wpdb->prefix}pc_users` WHERE api_key = %s LIMIT 1",
        $key
    ));
    return $row ?: null;
}

function pc_get_user_by_id(int $id): ?object {
    global $wpdb;
    $row = $wpdb->get_row($wpdb->prepare(
        "SELECT * FROM `{$wpdb->prefix}pc_users` WHERE id = %d LIMIT 1",
        $id
    ));
    return $row ?: null;
}

/**
 * Insert a new PMC user. $data keys match table columns.
 * Returns new row ID on success, false on failure.
 */
function pc_create_user(array $data): int|false {
    global $wpdb;
    $data['created_at'] = current_time('mysql');
    $data['updated_at'] = current_time('mysql');
    $result = $wpdb->insert($wpdb->prefix . 'pc_users', $data);
    if ($result === false) return false;
    return (int) $wpdb->insert_id;
}

/**
 * Update specified columns for a user by ID.
 * Always sets updated_at to now.
 */
function pc_update_user(int $id, array $data): bool {
    global $wpdb;
    $data['updated_at'] = current_time('mysql');
    $result = $wpdb->update(
        $wpdb->prefix . 'pc_users',
        $data,
        ['id' => $id]
    );
    return $result !== false;
}

/**
 * Fetch all PMC users with optional filters and sorting.
 *
 * Supported filters:
 *   plan            (string)  — exact plan slug
 *   key_status      (string)  — exact status
 *   search          (string)  — email LIKE %search%
 *   expiring_days   (int)     — key_expires within N days from now
 *   low_credits_pct (int)     — users whose remaining% < threshold
 *   created_from    (string)  — DATE(created_at) >= value
 *   created_to      (string)  — DATE(created_at) <= value
 *   active_from     (string)  — last_estimation >= value
 *   active_to       (string)  — last_estimation <= value
 *   orderby         (string)  — email|plan|key_status|key_expires|last_estimation|created_at|credits_remaining
 *   order           (string)  — ASC|DESC
 *
 * Returns each row plus SQL-computed 'credits_remaining'.
 */
function pc_get_all_pc_users(array $filters = []): array {
    global $wpdb;
    $table = $wpdb->prefix . 'pc_users';
    $where = ['1=1'];
    $vals  = [];

    if (!empty($filters['plan'])) {
        $where[] = 'plan = %s';
        $vals[]  = $filters['plan'];
    }
    if (!empty($filters['key_status'])) {
        $where[] = 'key_status = %s';
        $vals[]  = $filters['key_status'];
    }
    if (!empty($filters['search'])) {
        $where[] = 'email LIKE %s';
        $vals[]  = '%' . $wpdb->esc_like($filters['search']) . '%';
    }
    if (isset($filters['expiring_days']) && $filters['expiring_days'] > 0) {
        $where[] = 'key_expires IS NOT NULL AND key_expires >= CURDATE() AND key_expires <= DATE_ADD(CURDATE(), INTERVAL %d DAY)';
        $vals[]  = (int) $filters['expiring_days'];
    }
    if (!empty($filters['created_from'])) {
        $where[] = 'DATE(created_at) >= %s';
        $vals[]  = $filters['created_from'];
    }
    if (!empty($filters['created_to'])) {
        $where[] = 'DATE(created_at) <= %s';
        $vals[]  = $filters['created_to'];
    }
    if (!empty($filters['active_from'])) {
        $where[] = 'last_estimation >= %s';
        $vals[]  = $filters['active_from'] . ' 00:00:00';
    }
    if (!empty($filters['active_to'])) {
        $where[] = 'last_estimation <= %s';
        $vals[]  = $filters['active_to'] . ' 23:59:59';
    }

    // Sorting — whitelist only
    $allowed = [
        'email'             => 'email',
        'plan'              => 'plan',
        'key_status'        => 'key_status',
        'key_expires'       => 'key_expires',
        'last_estimation'   => 'last_estimation',
        'created_at'        => 'created_at',
        'credits_remaining' => 'GREATEST(0, credits_total - credits_used)',
    ];
    $ob_key = $filters['orderby'] ?? 'created_at';
    $ob_col = $allowed[$ob_key] ?? 'created_at';
    $od     = strtoupper($filters['order'] ?? 'DESC') === 'ASC' ? 'ASC' : 'DESC';

    // NULLs last for nullable date columns
    $null_last = '';
    if ($ob_key === 'last_estimation') $null_last = '(last_estimation IS NULL) ASC, ';
    elseif ($ob_key === 'key_expires')  $null_last = '(key_expires IS NULL) ASC, ';

    $where_sql = implode(' AND ', $where);
    $sql       = "SELECT *, GREATEST(0, credits_total - credits_used) AS credits_remaining
                  FROM `{$table}` WHERE {$where_sql}
                  ORDER BY {$null_last}{$ob_col} {$od}";

    $rows = (!empty($vals)
        ? $wpdb->get_results($wpdb->prepare($sql, ...$vals))
        : $wpdb->get_results($sql)) ?: [];

    // Post-filter computed field
    if (isset($filters['low_credits_pct']) && $filters['low_credits_pct'] > 0) {
        $threshold = (int) $filters['low_credits_pct'];
        $rows = array_filter($rows, function ($u) use ($threshold) {
            $total = (int) $u->credits_total;
            if ($total <= 0) return false;
            return ((int) $u->credits_remaining / $total * 100) < $threshold;
        });
    }

    return array_values($rows);
}

/**
 * Count users by key_status, or all users if $status is empty.
 */
function pc_get_user_count(string $status = ''): int {
    global $wpdb;
    $table = $wpdb->prefix . 'pc_users';
    if ($status !== '') {
        return (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM `{$table}` WHERE key_status = %s",
            $status
        ));
    }
    return (int) $wpdb->get_var("SELECT COUNT(*) FROM `{$table}`");
}

/**
 * Return overall user KPIs (not affected by list filters).
 */
function pc_get_user_kpis(): array {
    global $wpdb;
    $t = $wpdb->prefix . 'pc_users';
    return [
        'total'      => (int) $wpdb->get_var("SELECT COUNT(*) FROM `{$t}`"),
        'active'     => (int) $wpdb->get_var("SELECT COUNT(*) FROM `{$t}` WHERE key_status='active' AND (key_expires IS NULL OR key_expires >= CURDATE())"),
        'expiring_7' => (int) $wpdb->get_var("SELECT COUNT(*) FROM `{$t}` WHERE key_status='active' AND key_expires IS NOT NULL AND key_expires BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)"),
        'exhausted'  => (int) $wpdb->get_var("SELECT COUNT(*) FROM `{$t}` WHERE credits_total > 0 AND credits_used >= credits_total"),
    ];
}

/**
 * Remaining credits for a user object.
 */
function pc_credits_remaining(object $user): int {
    return max(0, (int) $user->credits_total - (int) $user->credits_used);
}
