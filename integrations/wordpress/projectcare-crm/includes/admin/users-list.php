<?php
defined('ABSPATH') || exit;

function pc_page_users(): void {
    if (!current_user_can('manage_options')) return;
    $user_id = isset($_GET['user_id']) ? (int) $_GET['user_id'] : 0;
    if ($user_id > 0) {
        pc_render_user_detail($user_id);
    } else {
        pc_render_users_list();
    }
}

function pc_render_users_list(): void {
    global $wpdb;

    // ── CSV Export ────────────────────────────────────────────────────────────
    if (isset($_GET['export']) && $_GET['export'] === '1' && current_user_can('manage_options')) {
        $users = pc_get_all_pc_users(['orderby' => 'email', 'order' => 'ASC']);
        header('Content-Type: text/csv');
        header('Content-Disposition: attachment; filename="projectcare-users-' . date('Ymd') . '.csv"');
        $out = fopen('php://output', 'w');
        fputcsv($out, ['id','email','plan','credits_total','credits_used','credits_remaining','key_status','key_expires','last_estimation','source','created_at']);
        foreach ($users as $u) {
            fputcsv($out, [$u->id,$u->email,$u->plan,$u->credits_total,$u->credits_used,(int)$u->credits_remaining,$u->key_status,$u->key_expires,$u->last_estimation,$u->source,$u->created_at]);
        }
        fclose($out);
        exit;
    }

    // ── Inline quick action POST (from list row) ──────────────────────────────
    $quick_notice = '';
    if (isset($_POST['pc_list_quick_nonce'], $_POST['pc_list_action'], $_POST['pc_list_uid'])) {
        $quid = (int) $_POST['pc_list_uid'];
        if ($quid > 0 && wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['pc_list_quick_nonce'])), 'pc_list_quick_' . $quid)) {
            $qu  = pc_get_user_by_id($quid);
            $qact = sanitize_text_field($_POST['pc_list_action']);
            if ($qu) {
                switch ($qact) {
                    case 'grant10': case 'grant25': case 'grant50': case 'grant100':
                        $amt = (int) substr($qact, 5);
                        $new_total = (int) $qu->credits_total + $amt;
                        pc_update_user($quid, ['credits_total' => $new_total]);
                        pc_log_activity(['user_id' => $quid, 'email' => $qu->email, 'action' => 'manual_grant',
                            'credits_cost' => -$amt, 'credits_before' => (int)$qu->credits_total,
                            'credits_after' => $new_total, 'result' => 'success',
                            'notes' => 'List quick grant +' . $amt . ' credits']);
                        $quick_notice = esc_html($qu->email) . ': granted +' . $amt . ' credits.';
                        break;
                    case 'switch_plan':
                        $new_plan = sanitize_text_field($_POST['pc_list_plan'] ?? '');
                        $plan_row = pc_get_plan($new_plan);
                        if ($plan_row) {
                            $old_plan = $qu->plan;
                            pc_update_user($quid, ['plan' => $new_plan]);
                            pc_log_activity(['user_id' => $quid, 'email' => $qu->email, 'action' => 'admin_edit',
                                'result' => 'success', 'notes' => 'Plan switched: ' . $old_plan . ' → ' . $new_plan . ' (history retained)']);
                            $quick_notice = esc_html($qu->email) . ': plan changed from ' . esc_html($old_plan) . ' to ' . esc_html($new_plan) . '. History retained.';
                        }
                        break;
                    case 'extend7': case 'extend30':
                        $days    = $qact === 'extend7' ? 7 : 30;
                        $new_exp = date('Y-m-d', strtotime(($qu->key_expires ?: 'now') . ' +' . $days . ' days'));
                        pc_update_user($quid, ['key_expires' => $new_exp, 'key_status' => 'active']);
                        pc_log_activity(['user_id' => $quid, 'email' => $qu->email, 'action' => 'manual_grant',
                            'result' => 'success', 'notes' => 'Extended +' . $days . 'd from list. New expiry: ' . $new_exp]);
                        $quick_notice = esc_html($qu->email) . ': extended +' . $days . 'd → ' . $new_exp . '.';
                        break;
                    case 'activate':
                        $upd = ['key_status' => 'active'];
                        if (!$qu->key_expires || strtotime($qu->key_expires) < time())
                            $upd['key_expires'] = date('Y-m-d', strtotime('+30 days'));
                        pc_update_user($quid, $upd);
                        pc_log_activity(['user_id' => $quid, 'email' => $qu->email, 'action' => 'admin_edit',
                            'result' => 'success', 'notes' => 'Activated from list']);
                        $quick_notice = esc_html($qu->email) . ': activated.';
                        break;
                    case 'suspend':
                        pc_update_user($quid, ['key_status' => 'suspended']);
                        pc_log_activity(['user_id' => $quid, 'email' => $qu->email, 'action' => 'suspension',
                            'result' => 'success', 'notes' => 'Suspended from list']);
                        $quick_notice = esc_html($qu->email) . ': suspended.';
                        break;
                    case 'reset_usage':
                        pc_update_user($quid, ['credits_used' => 0]);
                        pc_log_activity(['user_id' => $quid, 'email' => $qu->email, 'action' => 'admin_edit',
                            'result' => 'success', 'notes' => 'Usage reset to 0 from list']);
                        $quick_notice = esc_html($qu->email) . ': usage reset to 0.';
                        break;
                }
            }
        }
    }

    // ── Bulk action POST ──────────────────────────────────────────────────────
    $bulk_notice = '';
    if (isset($_POST['pc_bulk_nonce'], $_POST['bulk_action'], $_POST['user_ids'])) {
        if (wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['pc_bulk_nonce'])), 'pc_bulk_users')) {
            $action   = sanitize_text_field($_POST['bulk_action']);
            $user_ids = array_map('intval', (array) $_POST['user_ids']);
            $count    = 0;
            foreach ($user_ids as $uid) {
                $u = pc_get_user_by_id($uid);
                if (!$u) continue;
                switch ($action) {
                    case 'extend':
                        $new_exp = date('Y-m-d', strtotime(($u->key_expires ?: 'now') . ' +30 days'));
                        pc_update_user($uid, ['key_expires' => $new_exp]);
                        break;
                    case 'grant':
                        pc_update_user($uid, ['credits_total' => (int) $u->credits_total + 25]);
                        break;
                    case 'reset':
                        pc_update_user($uid, ['credits_used' => 0]);
                        break;
                    case 'reactivate':
                        pc_update_user($uid, ['key_status' => 'active']);
                        break;
                    case 'suspend':
                        pc_update_user($uid, ['key_status' => 'suspended']);
                        break;
                    case 'delete':
                        $del_user = $wpdb->delete($wpdb->prefix . 'pc_users',    ['id'      => $uid]);
                        $del_act  = $wpdb->delete($wpdb->prefix . 'pc_activity', ['user_id' => $uid]);
                        if (false === $del_user || false === $del_act) {
                            error_log('pmc bulk delete: DB error for user_id=' . $uid);
                        }
                        break;
                }
                $count++;
            }
            $bulk_notice = $count . ' user(s) updated.';
        }
    }

    // ── CSV Import POST ───────────────────────────────────────────────────────
    $import_notice = '';
    if (isset($_POST['pc_import_nonce']) && wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['pc_import_nonce'])), 'pc_import_users')) {
        if (!empty($_FILES['import_csv']['tmp_name'])) {
            $handle   = fopen($_FILES['import_csv']['tmp_name'], 'r');
            $header   = fgetcsv($handle);
            $imported = $skipped = $errors = 0;
            while (($row = fgetcsv($handle)) !== false) {
                $email = strtolower(sanitize_email($row[0] ?? ''));
                if (!is_email($email)) { $errors++; continue; }
                $data = [
                    'plan'          => sanitize_text_field($row[1] ?? 'trial'),
                    'credits_total' => (int) ($row[2] ?? 0),
                    'credits_used'  => (int) ($row[3] ?? 0),
                    'key_expires'   => sanitize_text_field($row[4] ?? ''),
                    'key_status'    => sanitize_text_field($row[5] ?? 'active'),
                ];
                $existing = pc_get_user_by_email($email);
                if ($existing) {
                    pc_update_user((int) $existing->id, $data);
                    $skipped++;
                } else {
                    $data['email']  = $email;
                    $data['source'] = 'import';
                    pc_create_user($data);
                    $imported++;
                }
            }
            fclose($handle);
            $import_notice = "Import complete: {$imported} imported, {$skipped} updated, {$errors} errors.";
        }
    }

    // ── Filters ───────────────────────────────────────────────────────────────
    $search        = sanitize_text_field($_GET['s']              ?? '');
    $filter_plan   = sanitize_text_field($_GET['plan']           ?? '');
    $filter_status = sanitize_text_field($_GET['status']         ?? '');
    $filter_expiry = sanitize_text_field($_GET['expiry_filter']  ?? '');
    $filter_cred   = sanitize_text_field($_GET['credit_filter']  ?? '');
    $created_from  = sanitize_text_field($_GET['created_from']   ?? '');
    $created_to    = sanitize_text_field($_GET['created_to']     ?? '');
    $active_from   = sanitize_text_field($_GET['active_from']    ?? '');
    $active_to     = sanitize_text_field($_GET['active_to']      ?? '');
    $orderby       = sanitize_text_field($_GET['orderby']        ?? 'created_at');
    $order         = strtoupper(sanitize_text_field($_GET['order'] ?? 'DESC')) === 'ASC' ? 'ASC' : 'DESC';
    $page_num      = max(1, (int) ($_GET['paged'] ?? 1));
    $per_page      = 25;

    $filter_args = ['orderby' => $orderby, 'order' => $order];
    if ($search)        $filter_args['search']       = $search;
    if ($filter_plan)   $filter_args['plan']          = $filter_plan;
    if ($filter_status) $filter_args['key_status']    = $filter_status;
    if ($filter_expiry === 'expiring_7')  $filter_args['expiring_days'] = 7;
    if ($filter_expiry === 'expiring_30') $filter_args['expiring_days'] = 30;
    if ($created_from)  $filter_args['created_from']  = $created_from;
    if ($created_to)    $filter_args['created_to']    = $created_to;
    if ($active_from)   $filter_args['active_from']   = $active_from;
    if ($active_to)     $filter_args['active_to']     = $active_to;

    $all_users = pc_get_all_pc_users($filter_args);

    // Post-filters (computed fields not in SQL)
    if ($filter_expiry === 'expired') {
        $all_users = array_filter($all_users, fn($u) => $u->key_expires && strtotime($u->key_expires) < time());
    }
    if ($filter_cred) {
        $all_users = array_filter($all_users, function ($u) use ($filter_cred) {
            $t = (int) $u->credits_total;
            if ($t <= 0) return $filter_cred === 'exhausted';
            $r   = (int) $u->credits_remaining;
            $pct = ($r / $t) * 100;
            if ($filter_cred === 'ok')        return $pct > 75;
            if ($filter_cred === 'warning')   return $pct <= 25;
            if ($filter_cred === 'critical')  return $pct < 10;
            if ($filter_cred === 'exhausted') return $r === 0;
            return true;
        });
    }

    $all_users = array_values($all_users);
    $total     = count($all_users);
    $users     = array_slice($all_users, ($page_num - 1) * $per_page, $per_page);
    $pages     = max(1, (int) ceil($total / $per_page));
    $plans     = pc_get_plans();
    $kpis      = pc_get_user_kpis();
    $base_url  = admin_url('admin.php?page=pmc-crm-users');

    // Build per-plan margin data for inline display
    $margin_data     = pc_get_margin_data();
    $cost_per_credit = (float) $margin_data['cost_per_credit'];
    $plan_meta       = [];
    foreach ($margin_data['plans'] as $pm) {
        $plan_meta[$pm['slug']] = $pm;
    }

    // Per-user call count + country from activity log (for current page only)
    $page_user_ids = array_map(fn($u) => (int) $u->id, $users);
    $call_counts = $geo_map = [];
    if (!empty($page_user_ids)) {
        $placeholders = implode(',', array_fill(0, count($page_user_ids), '%d'));
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT user_id, COUNT(*) AS calls,
                    MAX(geo_country) AS country,
                    MAX(ip_address) AS ip
             FROM `{$wpdb->prefix}pc_activity`
             WHERE user_id IN ($placeholders) AND action IN ('validate','deduct')
             GROUP BY user_id",
            ...$page_user_ids
        ), ARRAY_A) ?: [];
        foreach ($rows as $r) {
            $call_counts[(int)$r['user_id']] = (int) $r['calls'];
            $geo_map[(int)$r['user_id']]     = ['country' => $r['country'], 'ip' => $r['ip']];
        }
    }

    // Filter params for URL building (no 'page' key — base_url already has it)
    $filter_params = array_filter([
        's'             => $search,
        'plan'          => $filter_plan,
        'status'        => $filter_status,
        'expiry_filter' => $filter_expiry,
        'credit_filter' => $filter_cred,
        'created_from'  => $created_from,
        'created_to'    => $created_to,
        'active_from'   => $active_from,
        'active_to'     => $active_to,
        'orderby'       => ($orderby !== 'created_at') ? $orderby : '',
        'order'         => ($order !== 'DESC') ? $order : '',
    ]);

    // Current page URL to pass as return_url to detail pages
    $list_url = add_query_arg(array_merge(['page' => 'pmc-crm-users', 'paged' => $page_num], $filter_params), admin_url('admin.php'));

    // Active filter pills
    $active_pills = [];
    if ($search)        $active_pills[] = ['Search: ' . $search,                         's'];
    if ($filter_plan)   $active_pills[] = ['Plan: ' . ucfirst($filter_plan),              'plan'];
    if ($filter_status) $active_pills[] = ['Status: ' . ucfirst($filter_status),          'status'];
    if ($filter_expiry) $active_pills[] = ['Expiry: ' . str_replace('_', ' ', $filter_expiry), 'expiry_filter'];
    if ($filter_cred)   $active_pills[] = ['Credits: ' . $filter_cred,                   'credit_filter'];
    if ($created_from)  $active_pills[] = ['Signed up from: ' . $created_from,            'created_from'];
    if ($created_to)    $active_pills[] = ['Signed up to: ' . $created_to,                'created_to'];
    if ($active_from)   $active_pills[] = ['Active from: ' . $active_from,                'active_from'];
    if ($active_to)     $active_pills[] = ['Active to: ' . $active_to,                    'active_to'];

    // Sort URL builder
    $sort_url = function (string $col) use ($orderby, $order, $filter_params, $base_url): string {
        $next = ($orderby === $col && $order === 'ASC') ? 'DESC' : 'ASC';
        return add_query_arg(array_merge($filter_params, ['orderby' => $col, 'order' => $next, 'paged' => 1]), $base_url);
    };
    $sort_ind = function (string $col) use ($orderby, $order): string {
        if ($orderby !== $col) return '<span style="color:#ccc;font-size:10px"> ⇅</span>';
        return $order === 'ASC' ? '<span style="font-size:10px"> ▲</span>' : '<span style="font-size:10px"> ▼</span>';
    };

    $from_n = $total === 0 ? 0 : ($page_num - 1) * $per_page + 1;
    $to_n   = min($total, $page_num * $per_page);
    ?>
    <div class="wrap">

        <h1 style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            ProjectCare Users
            <a href="<?php echo esc_url($base_url . '&export=1'); ?>" class="page-title-action">Export CSV</a>
            <button type="button" class="page-title-action" id="pmc-import-toggle">Import CSV</button>
        </h1>

        <?php if ($quick_notice): ?>
            <div class="notice notice-success is-dismissible"><p><?php echo wp_kses_post($quick_notice); ?></p></div>
        <?php endif; ?>
        <?php if ($bulk_notice): ?>
            <div class="notice notice-success is-dismissible"><p><?php echo esc_html($bulk_notice); ?></p></div>
        <?php endif; ?>
        <?php if ($import_notice): ?>
            <div class="notice notice-info is-dismissible"><p><?php echo esc_html($import_notice); ?></p></div>
        <?php endif; ?>

        <!-- Import panel (collapsible) -->
        <div id="pmc-import-panel" style="display:none;background:#fff;border:1px solid #ddd;border-radius:6px;padding:16px;margin-bottom:16px">
            <h3 style="margin-top:0">Import Users (CSV)</h3>
            <p style="color:#666;font-size:13px">Columns: email, plan, credits_total, credits_used, key_expires (YYYY-MM-DD), key_status. Existing emails are updated; new emails are created.</p>
            <form method="post" enctype="multipart/form-data" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                <?php wp_nonce_field('pc_import_users', 'pc_import_nonce'); ?>
                <input type="file" name="import_csv" accept=".csv">
                <?php submit_button('Import', 'secondary', '', false); ?>
            </form>
        </div>

        <!-- KPI pills -->
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">
            <?php
            $kpi_items = [
                ['Total',        $kpis['total'],      $base_url,                                                                                                           '#1d2327', '#f6f7f7'],
                ['Active',       $kpis['active'],     add_query_arg(['page' => 'pmc-crm-users', 'status' => 'active'], admin_url('admin.php')),                            '#065f46', '#d1fae5'],
                ['Expiring 7d',  $kpis['expiring_7'], add_query_arg(['page' => 'pmc-crm-users', 'expiry_filter' => 'expiring_7'], admin_url('admin.php')),                 '#92400e', '#fef3c7'],
                ['Exhausted',    $kpis['exhausted'],  add_query_arg(['page' => 'pmc-crm-users', 'credit_filter' => 'exhausted'], admin_url('admin.php')),                  '#991b1b', '#fee2e2'],
            ];
            foreach ($kpi_items as [$label, $value, $url, $fg, $bg]): ?>
                <a href="<?php echo esc_url($url); ?>" style="text-decoration:none;background:<?php echo esc_attr($bg); ?>;border:1px solid rgba(0,0,0,.08);border-radius:8px;padding:10px 18px;min-width:90px;text-align:center;display:block;transition:box-shadow .15s" onmouseover="this.style.boxShadow='0 2px 8px rgba(0,0,0,.12)'" onmouseout="this.style.boxShadow=''">
                    <div style="font-size:22px;font-weight:700;color:<?php echo esc_attr($fg); ?>"><?php echo esc_html($value); ?></div>
                    <div style="font-size:11px;color:#666;margin-top:2px"><?php echo esc_html($label); ?></div>
                </a>
            <?php endforeach; ?>
        </div>

        <!-- Filter form -->
        <form method="get" style="background:#fff;border:1px solid #ddd;border-radius:6px;padding:14px;margin-bottom:10px">
            <input type="hidden" name="page" value="pmc-crm-users">

            <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end">
                <div>
                    <label style="font-size:12px;font-weight:600;display:block;margin-bottom:3px">Search</label>
                    <input type="text" name="s" value="<?php echo esc_attr($search); ?>" placeholder="Email…" style="width:180px">
                </div>
                <div>
                    <label style="font-size:12px;font-weight:600;display:block;margin-bottom:3px">Plan</label>
                    <select name="plan">
                        <option value="">All Plans</option>
                        <?php foreach ($plans as $p): ?>
                            <option value="<?php echo esc_attr($p['slug']); ?>" <?php selected($filter_plan, $p['slug']); ?>><?php echo esc_html($p['label']); ?></option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div>
                    <label style="font-size:12px;font-weight:600;display:block;margin-bottom:3px">Status</label>
                    <select name="status">
                        <option value="">Any Status</option>
                        <?php foreach (['active','expired','inactive','suspended','cancelled','superseded'] as $st): ?>
                            <option value="<?php echo esc_attr($st); ?>" <?php selected($filter_status, $st); ?>><?php echo esc_html(ucfirst($st)); ?></option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div>
                    <label style="font-size:12px;font-weight:600;display:block;margin-bottom:3px">Expiry</label>
                    <select name="expiry_filter">
                        <option value="">Any</option>
                        <option value="expiring_7"  <?php selected($filter_expiry, 'expiring_7'); ?>>Expiring 7 days</option>
                        <option value="expiring_30" <?php selected($filter_expiry, 'expiring_30'); ?>>Expiring 30 days</option>
                        <option value="expired"     <?php selected($filter_expiry, 'expired'); ?>>Expired</option>
                    </select>
                </div>
                <div>
                    <label style="font-size:12px;font-weight:600;display:block;margin-bottom:3px">Credits</label>
                    <select name="credit_filter">
                        <option value="">Any</option>
                        <option value="ok"        <?php selected($filter_cred, 'ok'); ?>>OK (&gt;75%)</option>
                        <option value="warning"   <?php selected($filter_cred, 'warning'); ?>>Warning (&lt;25%)</option>
                        <option value="critical"  <?php selected($filter_cred, 'critical'); ?>>Critical (&lt;10%)</option>
                        <option value="exhausted" <?php selected($filter_cred, 'exhausted'); ?>>Exhausted</option>
                    </select>
                </div>
                <?php submit_button('Filter', 'secondary', '', false); ?>
                <?php if (!empty($active_pills)): ?>
                    <a href="<?php echo esc_url($base_url); ?>" class="button">Clear All</a>
                <?php endif; ?>
            </div>

            <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin-top:10px;padding-top:10px;border-top:1px solid #f0f0f0">
                <div>
                    <label style="font-size:12px;font-weight:600;display:block;margin-bottom:3px">Signed up from</label>
                    <input type="date" name="created_from" value="<?php echo esc_attr($created_from); ?>">
                </div>
                <div>
                    <label style="font-size:12px;font-weight:600;display:block;margin-bottom:3px">Signed up to</label>
                    <input type="date" name="created_to" value="<?php echo esc_attr($created_to); ?>">
                </div>
                <div>
                    <label style="font-size:12px;font-weight:600;display:block;margin-bottom:3px">Last active from</label>
                    <input type="date" name="active_from" value="<?php echo esc_attr($active_from); ?>">
                </div>
                <div>
                    <label style="font-size:12px;font-weight:600;display:block;margin-bottom:3px">Last active to</label>
                    <input type="date" name="active_to" value="<?php echo esc_attr($active_to); ?>">
                </div>
            </div>
        </form>

        <!-- Active filter pills -->
        <?php if (!empty($active_pills)): ?>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">
            <?php foreach ($active_pills as [$label, $param]):
                $clear_url = add_query_arg(array_merge($filter_params, [$param => false, 'paged' => 1]), $base_url);
            ?>
                <span style="background:#e0e7ff;color:#1e40af;padding:3px 10px;border-radius:12px;font-size:12px;display:inline-flex;align-items:center;gap:6px">
                    <?php echo esc_html($label); ?>
                    <a href="<?php echo esc_url($clear_url); ?>" style="color:#1e40af;text-decoration:none;font-weight:700;font-size:14px;line-height:1">&times;</a>
                </span>
            <?php endforeach; ?>
        </div>
        <?php endif; ?>

        <!-- Bulk action + table -->
        <form method="post">
            <?php wp_nonce_field('pc_bulk_users', 'pc_bulk_nonce'); ?>

            <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap">
                <select name="bulk_action">
                    <option value="">Bulk Action</option>
                    <option value="extend">Extend +30 Days</option>
                    <option value="grant">Grant +25 Credits</option>
                    <option value="reset">Reset Usage to 0</option>
                    <option value="reactivate">Reactivate</option>
                    <option value="suspend">Suspend</option>
                    <option value="delete">Delete (cannot undo)</option>
                </select>
                <button type="submit" class="button">Apply</button>
                <span style="color:#666;font-size:13px">
                    <?php if ($total > 0): ?>
                        Showing <?php echo esc_html($from_n . '–' . $to_n . ' of ' . number_format($total)); ?> user(s)
                    <?php else: ?>
                        No users found
                    <?php endif; ?>
                </span>
            </div>

            <div style="overflow-x:auto">
            <table class="widefat striped" style="border-radius:6px;font-size:12px;min-width:1600px">
                <thead>
                    <tr style="background:#f6f7f7">
                        <th style="width:28px"><input type="checkbox" id="pmc-check-all"></th>
                        <th><a href="<?php echo esc_url($sort_url('email')); ?>" style="text-decoration:none;color:inherit">Email<?php echo $sort_ind('email'); ?></a></th>
                        <th><a href="<?php echo esc_url($sort_url('plan')); ?>" style="text-decoration:none;color:inherit">Plan<?php echo $sort_ind('plan'); ?></a></th>
                        <th>Tier</th>
                        <th style="text-align:right">Price</th>
                        <th style="text-align:right">Stripe fee</th>
                        <th style="text-align:right">Net rev</th>
                        <th style="text-align:right">Rev/credit</th>
                        <th style="text-align:right">Cost/credit</th>
                        <th style="text-align:right">Margin</th>
                        <th><a href="<?php echo esc_url($sort_url('key_status')); ?>" style="text-decoration:none;color:inherit">Status<?php echo $sort_ind('key_status'); ?></a></th>
                        <th><a href="<?php echo esc_url($sort_url('key_expires')); ?>" style="text-decoration:none;color:inherit">Expires<?php echo $sort_ind('key_expires'); ?></a></th>
                        <th><a href="<?php echo esc_url($sort_url('credits_remaining')); ?>" style="text-decoration:none;color:inherit">Credits<?php echo $sort_ind('credits_remaining'); ?></a></th>
                        <th style="text-align:right">Calls</th>
                        <th>Country</th>
                        <th><a href="<?php echo esc_url($sort_url('last_estimation')); ?>" style="text-decoration:none;color:inherit">Last Used<?php echo $sort_ind('last_estimation'); ?></a></th>
                        <th>Source</th>
                        <th><a href="<?php echo esc_url($sort_url('created_at')); ?>" style="text-decoration:none;color:inherit">Joined<?php echo $sort_ind('created_at'); ?></a></th>
                        <th style="width:110px">Actions</th>
                    </tr>
                </thead>
                <tbody>
                <?php
                // Totals accumulators
                $tot_credits_total = $tot_credits_used = $tot_credits_rem = 0;
                $tot_net_rev = 0.0;
                $tot_calls   = 0;
                $tot_paying  = 0;

                foreach ($users as $u):
                    $is_expired = $u->key_expires && strtotime($u->key_expires) < time();
                    $detail_url = admin_url('admin.php?page=pmc-crm-users&user_id=' . $u->id . '&return_url=' . urlencode($list_url));

                    $exp_style = '';
                    if ($u->key_expires) {
                        $days_left = (strtotime($u->key_expires) - time()) / 86400;
                        if ($days_left < 0)      $exp_style = 'color:#b32d2e;font-weight:600';
                        elseif ($days_left < 7)  $exp_style = 'color:#c05600;font-weight:600';
                        elseif ($days_left < 14) $exp_style = 'color:#f0a500';
                    }

                    // Per-user plan pricing & margin
                    $pm           = $plan_meta[$u->plan] ?? null;
                    $u_tier       = $pm ? $pm['gas_tier']        : '—';
                    $u_price      = $pm ? $pm['price']           : 0;
                    $u_unlimited  = $pm ? $pm['unlimited']       : false;
                    $u_stripe     = $pm ? $pm['stripe_fee']      : 0;
                    $u_net        = $pm ? $pm['net_revenue']     : 0;
                    $u_rpc        = $pm ? $pm['rev_per_credit']  : 0;
                    $u_margin     = $pm ? $pm['gross_margin_pct']: null;
                    $margin_color = $u_margin === null ? '#999' : ($u_margin >= 50 ? '#0a6b0a' : ($u_margin >= 0 ? '#996633' : '#b32d2e'));

                    $u_calls   = $call_counts[(int)$u->id] ?? 0;
                    $u_country = $geo_map[(int)$u->id]['country'] ?? '';

                    // Accumulate totals
                    $tot_credits_total += (int) $u->credits_total;
                    $tot_credits_used  += (int) $u->credits_used;
                    $tot_credits_rem   += max(0, (int) $u->credits_remaining);
                    $tot_calls         += $u_calls;
                    if ($u_price > 0) { $tot_net_rev += $u_net; $tot_paying++; }
                ?>
                    <tr>
                        <td><input type="checkbox" name="user_ids[]" value="<?php echo esc_attr($u->id); ?>"></td>
                        <td>
                            <a href="<?php echo esc_url($detail_url); ?>" style="font-weight:600;text-decoration:none;color:#1d2327">
                                <?php echo esc_html($u->email); ?>
                            </a>
                            <?php if (!empty($u->notes)): ?><span title="<?php echo esc_attr($u->notes); ?>" style="color:#f0a500;cursor:help"> ✎</span><?php endif; ?>
                        </td>
                        <td><?php echo pc_plan_badge($u->plan); ?></td>
                        <td><span style="font-size:11px;background:#f0f0f0;padding:1px 5px;border-radius:3px"><?php echo esc_html($u_tier); ?></span></td>
                        <td style="text-align:right"><?php echo $u_price > 0 ? '$' . esc_html(number_format($u_price, 2)) : '<span style="color:#999">free</span>'; ?></td>
                        <td style="text-align:right;color:#666"><?php echo $u_price > 0 ? '$' . esc_html($u_stripe) : '—'; ?></td>
                        <td style="text-align:right"><?php echo $u_price > 0 ? '$' . esc_html($u_net) : '—'; ?></td>
                        <td style="text-align:right;font-family:monospace"><?php echo (!$u_unlimited && $u_rpc > 0) ? '$' . esc_html($u_rpc) : '<span style="color:#999">—</span>'; ?></td>
                        <td style="text-align:right;font-family:monospace"><?php echo $cost_per_credit > 0 ? '$' . esc_html(number_format($cost_per_credit, 4)) : '<span style="color:#999">—</span>'; ?></td>
                        <td style="text-align:right;font-weight:bold;color:<?php echo esc_attr($margin_color); ?>"><?php echo $u_margin !== null ? esc_html($u_margin) . '%' : '—'; ?></td>
                        <td><?php echo pc_status_badge($u->key_status, $is_expired); ?></td>
                        <td style="<?php echo esc_attr($exp_style); ?>"><?php echo esc_html($u->key_expires ?: '—'); ?></td>
                        <td><?php echo pc_credits_bar_html((int) $u->credits_used, (int) $u->credits_total); ?></td>
                        <td style="text-align:right;color:#555"><?php echo $u_calls > 0 ? esc_html(number_format($u_calls)) : '<span style="color:#ccc">0</span>'; ?></td>
                        <td style="color:#555"><?php echo esc_html($u_country ?: '—'); ?></td>
                        <td style="color:#555"><?php echo esc_html(pc_relative_time($u->last_estimation)); ?></td>
                        <td style="color:#555"><?php echo esc_html($u->source ?: '—'); ?></td>
                        <td style="color:#555"><?php echo esc_html($u->created_at ? substr($u->created_at, 0, 10) : '—'); ?></td>
                        <td>
                            <!-- Quick action menu -->
                            <div style="position:relative;display:inline-block">
                                <button type="button" class="button button-small pmc-actions-toggle">Actions ▾</button>
                                <div class="pmc-actions-menu" style="display:none;position:absolute;right:0;top:100%;z-index:9999;background:#fff;border:1px solid #ddd;border-radius:4px;min-width:180px;box-shadow:0 2px 8px rgba(0,0,0,.15);padding:6px 0">
                                    <div style="padding:4px 10px;font-size:11px;color:#888;font-weight:600;text-transform:uppercase;letter-spacing:.5px">Navigate</div>
                                    <a href="<?php echo esc_url($detail_url); ?>" style="display:block;padding:6px 12px;font-size:12px;text-decoration:none;color:#1d2327">✏ Edit Profile</a>
                                    <a href="<?php echo esc_url($detail_url . '#tab-email'); ?>" style="display:block;padding:6px 12px;font-size:12px;text-decoration:none;color:#1d2327">✉ Send Email</a>
                                    <a href="<?php echo esc_url($detail_url . '#tab-activity'); ?>" style="display:block;padding:6px 12px;font-size:12px;text-decoration:none;color:#1d2327">📋 Activity</a>
                                    <div style="border-top:1px solid #eee;margin:4px 0;padding:4px 10px;font-size:11px;color:#888;font-weight:600;text-transform:uppercase;letter-spacing:.5px">Quick Actions</div>
                                    <!-- Grant credits -->
                                    <form method="post" style="padding:4px 12px;display:flex;align-items:center;gap:4px">
                                        <?php wp_nonce_field('pc_list_quick_' . $u->id, 'pc_list_quick_nonce'); ?>
                                        <input type="hidden" name="pc_list_uid"    value="<?php echo esc_attr($u->id); ?>">
                                        <input type="hidden" name="pc_list_action" value="">
                                        <span style="font-size:11px;color:#444">Grant:</span>
                                        <?php foreach ([10,25,50,100] as $amt): ?>
                                        <button type="submit" class="button button-small pmc-grant-btn" data-action="grant<?php echo $amt; ?>" style="padding:1px 5px;font-size:11px">+<?php echo $amt; ?></button>
                                        <?php endforeach; ?>
                                    </form>
                                    <!-- Switch plan -->
                                    <form method="post" style="padding:4px 12px;display:flex;align-items:center;gap:4px">
                                        <?php wp_nonce_field('pc_list_quick_' . $u->id, 'pc_list_quick_nonce'); ?>
                                        <input type="hidden" name="pc_list_uid"    value="<?php echo esc_attr($u->id); ?>">
                                        <input type="hidden" name="pc_list_action" value="switch_plan">
                                        <span style="font-size:11px;color:#444">Plan:</span>
                                        <select name="pc_list_plan" style="font-size:11px;height:22px">
                                            <?php foreach ($plans as $p): ?>
                                            <option value="<?php echo esc_attr($p['slug']); ?>" <?php selected($u->plan, $p['slug']); ?>><?php echo esc_html($p['label']); ?></option>
                                            <?php endforeach; ?>
                                        </select>
                                        <button type="submit" class="button button-small" style="padding:1px 6px;font-size:11px">Switch</button>
                                    </form>
                                    <!-- Extend -->
                                    <form method="post" style="padding:4px 12px;display:flex;align-items:center;gap:4px">
                                        <?php wp_nonce_field('pc_list_quick_' . $u->id, 'pc_list_quick_nonce'); ?>
                                        <input type="hidden" name="pc_list_uid"    value="<?php echo esc_attr($u->id); ?>">
                                        <input type="hidden" name="pc_list_action" value="">
                                        <span style="font-size:11px;color:#444">Extend:</span>
                                        <button type="submit" class="button button-small pmc-grant-btn" data-action="extend7"  style="padding:1px 5px;font-size:11px">+7d</button>
                                        <button type="submit" class="button button-small pmc-grant-btn" data-action="extend30" style="padding:1px 5px;font-size:11px">+30d</button>
                                    </form>
                                    <!-- Status -->
                                    <form method="post" style="padding:4px 12px;display:flex;align-items:center;gap:4px">
                                        <?php wp_nonce_field('pc_list_quick_' . $u->id, 'pc_list_quick_nonce'); ?>
                                        <input type="hidden" name="pc_list_uid"    value="<?php echo esc_attr($u->id); ?>">
                                        <input type="hidden" name="pc_list_action" value="">
                                        <button type="submit" class="button button-small pmc-grant-btn" data-action="activate"    style="padding:1px 5px;font-size:11px;color:#0a6b0a">Activate</button>
                                        <button type="submit" class="button button-small pmc-grant-btn" data-action="suspend"     style="padding:1px 5px;font-size:11px;color:#b32d2e">Suspend</button>
                                        <button type="submit" class="button button-small pmc-grant-btn" data-action="reset_usage" style="padding:1px 5px;font-size:11px">Reset</button>
                                    </form>
                                </div>
                            </div>
                        </td>
                    </tr>
                <?php endforeach; ?>

                <?php if (empty($users)): ?>
                    <tr><td colspan="19" style="text-align:center;color:#666;padding:28px 0">No users found.</td></tr>
                <?php else: ?>
                <!-- Totals row -->
                <tr style="background:#f0f6fc;font-weight:600;border-top:2px solid #2271b1">
                    <td></td>
                    <td style="color:#2271b1">Totals (<?php echo esc_html($to_n - $from_n + 1); ?> shown<?php echo $total > count($users) ? ', ' . number_format($total) . ' total' : ''; ?>)</td>
                    <td colspan="2"></td>
                    <td></td><!-- price -->
                    <td></td><!-- stripe fee -->
                    <td style="text-align:right"><?php echo $tot_net_rev > 0 ? '$' . esc_html(number_format($tot_net_rev, 2)) : '—'; ?>
                        <?php if ($tot_paying > 0): ?><div style="font-size:10px;color:#666;font-weight:400"><?php echo esc_html($tot_paying); ?> paying</div><?php endif; ?>
                    </td>
                    <td colspan="3"></td><!-- rev/credit, cost/credit, margin -->
                    <td></td><!-- status -->
                    <td></td><!-- expires -->
                    <td>
                        <span style="font-size:11px;color:#555;font-weight:400">
                            <?php echo esc_html(number_format($tot_credits_used)); ?> used<br>
                            <?php echo esc_html(number_format($tot_credits_rem)); ?> rem<br>
                            <?php echo esc_html(number_format($tot_credits_total)); ?> total
                        </span>
                    </td>
                    <td style="text-align:right"><?php echo esc_html(number_format($tot_calls)); ?></td>
                    <td colspan="4"></td>
                    <td></td>
                </tr>
                <?php endif; ?>
                </tbody>
            </table>
            </div>
        </form>

        <!-- Pagination -->
        <?php if ($pages > 1): ?>
        <div style="margin-top:14px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
            <span style="color:#666;font-size:13px">Showing <?php echo esc_html($from_n . '–' . $to_n . ' of ' . number_format($total)); ?></span>
            <?php echo pc_build_pagination($page_num, $pages, $filter_params, $base_url); ?>
        </div>
        <?php endif; ?>

        <script>
        (function() {
            // Check all
            var ca = document.getElementById('pmc-check-all');
            if (ca) ca.addEventListener('change', function() {
                document.querySelectorAll('input[name="user_ids[]"]').forEach(function(cb) { cb.checked = ca.checked; });
            });

            // Actions dropdowns
            document.querySelectorAll('.pmc-actions-toggle').forEach(function(btn) {
                btn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    var menu = this.nextElementSibling;
                    var wasOpen = menu.style.display === 'block';
                    document.querySelectorAll('.pmc-actions-menu').forEach(function(m) { m.style.display = 'none'; });
                    if (!wasOpen) menu.style.display = 'block';
                });
            });
            document.addEventListener('click', function() {
                document.querySelectorAll('.pmc-actions-menu').forEach(function(m) { m.style.display = 'none'; });
            });

            // Quick action buttons — set hidden action field before submit
            document.querySelectorAll('.pmc-grant-btn').forEach(function(btn) {
                btn.addEventListener('click', function(e) {
                    var form = this.closest('form');
                    var actionInput = form.querySelector('[name="pc_list_action"]');
                    if (actionInput) actionInput.value = this.dataset.action;
                });
            });

            // Import toggle
            var itBtn = document.getElementById('pmc-import-toggle');
            var itPanel = document.getElementById('pmc-import-panel');
            if (itBtn && itPanel) {
                itBtn.addEventListener('click', function() {
                    itPanel.style.display = itPanel.style.display === 'none' ? 'block' : 'none';
                });
            }
        })();
        </script>
    </div>
    <?php
}
