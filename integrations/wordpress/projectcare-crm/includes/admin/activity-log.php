<?php
defined('ABSPATH') || exit;

function pc_page_activity(): void {
    if (!current_user_can('manage_options')) return;

    // Filters
    $date_from    = sanitize_text_field($_GET['date_from'] ?? date('Y-m-d', strtotime('-30 days')));
    $date_to      = sanitize_text_field($_GET['date_to']   ?? date('Y-m-d'));
    $email_search = sanitize_text_field($_GET['email']     ?? '');
    $action_f     = sanitize_text_field($_GET['action_f']  ?? '');
    $result_f     = sanitize_text_field($_GET['result_f']  ?? '');
    $ip_search    = sanitize_text_field($_GET['ip']        ?? '');
    $page_num     = max(1, (int) ($_GET['paged'] ?? 1));
    $per_page     = 50;

    $filters = ['date_from' => $date_from, 'date_to' => $date_to];
    if ($email_search) $filters['email']  = $email_search;
    if ($action_f)     $filters['action'] = $action_f;
    if ($result_f)     $filters['result'] = $result_f;
    if ($ip_search)    $filters['ip_address'] = $ip_search;

    // CSV export
    if (isset($_GET['export']) && $_GET['export'] === '1') {
        $all_rows = pc_get_activity($filters, 100000, 0);
        header('Content-Type: text/csv');
        header('Content-Disposition: attachment; filename="pmc-activity-' . date('Ymd') . '.csv"');
        $out = fopen('php://output', 'w');
        fputcsv($out, ['id','created_at','email','action','operation_type','credits_cost','credits_before','credits_after','duration_ms','gas_exec_count','task_count','has_sliders','feasibility_avg','geo_country','geo_region','ip_address','result','notes']);
        foreach ($all_rows as $r) {
            fputcsv($out, [
                (int)$r->id, $r->created_at, $r->email, $r->action, $r->operation_type,
                (int)$r->credits_cost, (int)$r->credits_before, (int)$r->credits_after,
                (int)$r->duration_ms, (int)$r->gas_exec_count,
                (int)($r->task_count ?? 0), (int)($r->has_sliders ?? 0),
                round((float)($r->feasibility_avg ?? 0), 1),
                $r->geo_country ?? '', $r->geo_region ?? '',
                $r->ip_address, $r->result, $r->notes,
            ]);
        }
        fclose($out);
        exit;
    }

    $total  = pc_get_activity_count($filters);
    $rows   = pc_get_activity($filters, $per_page, ($page_num - 1) * $per_page);
    $pages  = max(1, (int) ceil($total / $per_page));

    // Summary totals
    global $wpdb;
    $table  = $wpdb->prefix . 'pc_activity';
    $sum_credits = (int) $wpdb->get_var($wpdb->prepare(
        "SELECT COALESCE(SUM(credits_cost),0) FROM `{$table}` WHERE created_at BETWEEN %s AND %s",
        $date_from . ' 00:00:00', $date_to . ' 23:59:59'
    ));

    $base_url = admin_url('admin.php?page=pmc-crm-activity');
    $actions  = ['trial_request','validate','deduct','key_regen','session_save','stripe_payment','stripe_cancel','stripe_renew','manual_grant','suspension','email_sent','admin_edit'];
    ?>
    <div class="wrap">
        <h1>Activity Log
            <a href="<?php echo esc_url(add_query_arg(['export' => '1', 'date_from' => $date_from, 'date_to' => $date_to, 'email' => $email_search, 'action_f' => $action_f, 'result_f' => $result_f, 'ip' => $ip_search], $base_url)); ?>" class="page-title-action">Export CSV</a>
        </h1>

        <!-- Filter form -->
        <form method="get" style="margin:12px 0;display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end">
            <input type="hidden" name="page" value="pmc-crm-activity">
            <div><label>From<br><input type="date" name="date_from" value="<?php echo esc_attr($date_from); ?>"></label></div>
            <div><label>To<br><input type="date" name="date_to" value="<?php echo esc_attr($date_to); ?>"></label></div>
            <div><label>Email<br><input type="text" name="email" value="<?php echo esc_attr($email_search); ?>" placeholder="Search..."></label></div>
            <div><label>Action<br>
                <select name="action_f">
                    <option value="">All Actions</option>
                    <?php foreach ($actions as $a): ?>
                        <option value="<?php echo esc_attr($a); ?>" <?php selected($action_f, $a); ?>><?php echo esc_html($a); ?></option>
                    <?php endforeach; ?>
                </select></label></div>
            <div><label>Result<br>
                <select name="result_f">
                    <option value="">All</option>
                    <option value="success"  <?php selected($result_f, 'success'); ?>>Success</option>
                    <option value="fail"     <?php selected($result_f, 'fail'); ?>>Fail</option>
                    <option value="error"    <?php selected($result_f, 'error'); ?>>Error</option>
                </select></label></div>
            <div><label>IP<br><input type="text" name="ip" value="<?php echo esc_attr($ip_search); ?>" placeholder="IP..." style="width:120px"></label></div>
            <?php submit_button('Filter', 'secondary', '', false); ?>
        </form>

        <!-- Summary bar -->
        <p style="color:#444;margin:8px 0">
            <strong><?php echo esc_html(number_format($total)); ?></strong> matching events &mdash;
            <strong><?php echo esc_html(number_format($sum_credits)); ?></strong> total credits consumed in window
        </p>

        <table class="widefat striped" style="font-size:12px">
            <thead>
                <tr>
                    <th>Date</th><th>Email</th><th>Action</th><th>Operation</th>
                    <th>Cost</th><th>Before&rarr;After</th><th>Duration</th>
                    <th>Tasks</th><th>Sliders</th><th>Feasibility</th>
                    <th>Geo</th><th>IP</th><th>Result</th><th>Notes</th>
                </tr>
            </thead>
            <tbody>
            <?php foreach ($rows as $row):
                $res_color    = $row->result === 'success' ? '#0a6b0a' : '#b32d2e';
                $before_after = ($row->credits_before || $row->credits_after)
                    ? $row->credits_before . '→' . $row->credits_after : '—';
                $user_url     = $row->email
                    ? admin_url('admin.php?page=pmc-crm-activity&email=' . urlencode($row->email))
                    : '';
                $is_deduct    = $row->action === 'deduct';
                $task_count   = (int) ($row->task_count ?? 0);
                $has_sliders  = (int) ($row->has_sliders ?? 0);
                $feas         = round((float) ($row->feasibility_avg ?? 0), 1);
                $geo_country  = $row->geo_country ?? '';
                $geo_region   = $row->geo_region  ?? '';
                $geo_label    = $geo_country ?: '—';
                $geo_title    = $geo_region ? $geo_country . ' / ' . $geo_region : $geo_country;
            ?>
                <tr>
                    <td><?php echo esc_html($row->created_at); ?></td>
                    <td><?php if ($user_url): ?><a href="<?php echo esc_url($user_url); ?>"><?php echo esc_html($row->email); ?></a><?php else: ?>—<?php endif; ?></td>
                    <td><?php echo esc_html($row->action); ?></td>
                    <td><?php echo esc_html($row->operation_type ?: '—'); ?></td>
                    <td><?php echo $row->credits_cost ? esc_html($row->credits_cost) : '—'; ?></td>
                    <td><?php echo esc_html($before_after); ?></td>
                    <td><?php echo $row->duration_ms ? esc_html($row->duration_ms . 'ms') : '—'; ?></td>
                    <td><?php echo $is_deduct && $task_count ? esc_html($task_count) : '—'; ?></td>
                    <td><?php if ($is_deduct): ?>
                        <span style="color:<?php echo $has_sliders ? '#0a6b0a' : '#888'; ?>"><?php echo $has_sliders ? 'Yes' : 'No'; ?></span>
                    <?php else: ?>—<?php endif; ?></td>
                    <td><?php if ($is_deduct && $feas > 0): ?>
                        <span style="font-weight:bold;color:<?php echo $feas >= 70 ? '#0a6b0a' : ($feas >= 40 ? '#b87c00' : '#b32d2e'); ?>"><?php echo esc_html($feas); ?></span>
                    <?php else: ?>—<?php endif; ?></td>
                    <td title="<?php echo esc_attr($geo_title); ?>"><?php echo esc_html($geo_label); ?></td>
                    <td><?php echo esc_html($row->ip_address ?: '—'); ?></td>
                    <td style="color:<?php echo esc_attr($res_color); ?>;font-weight:bold"><?php echo esc_html($row->result); ?></td>
                    <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="<?php echo esc_attr($row->notes ?? ''); ?>"><?php echo esc_html(mb_substr($row->notes ?? '', 0, 60)); ?></td>
                </tr>
            <?php endforeach; ?>
            <?php if (empty($rows)): ?>
                <tr><td colspan="14" style="color:#666;text-align:center">No activity found.</td></tr>
            <?php endif; ?>
            </tbody>
        </table>

        <!-- Pagination -->
        <?php if ($pages > 1): ?>
        <div style="margin-top:12px">
            <?php for ($i = 1; $i <= min($pages, 30); $i++):
                $pg_url = add_query_arg(['paged' => $i, 'date_from' => $date_from, 'date_to' => $date_to,
                    'email' => $email_search, 'action_f' => $action_f, 'result_f' => $result_f, 'ip' => $ip_search], $base_url);
            ?>
                <a href="<?php echo esc_url($pg_url); ?>"
                   class="button <?php echo $i === $page_num ? 'button-primary' : ''; ?>"
                   style="margin-right:2px"><?php echo esc_html($i); ?></a>
            <?php endfor; ?>
            <?php if ($pages > 30): ?>
                <span style="color:#666"> &hellip; <?php echo esc_html($pages); ?> pages total</span>
            <?php endif; ?>
        </div>
        <?php endif; ?>
    </div>
    <?php
}
