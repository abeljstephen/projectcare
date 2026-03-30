<?php
defined('ABSPATH') || exit;

function pc_page_dashboard(): void {
    if (!current_user_can('manage_options')) return;

    // Handle quick actions (extend / grant credits)
    if (isset($_POST['pc_quick_uid'], $_POST['pc_quick_nonce'], $_POST['pc_quick_action'])) {
        $uid    = (int) $_POST['pc_quick_uid'];
        $action = sanitize_text_field($_POST['pc_quick_action']);
        if (wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['pc_quick_nonce'])), 'pc_quick_action_' . $uid)) {
            $user = pc_get_user_by_id($uid);
            if ($user) {
                if ($action === 'extend10') {
                    $new_exp = date('Y-m-d', strtotime(($user->key_expires ?: 'now') . ' +10 days'));
                    pc_update_user($uid, ['key_expires' => $new_exp, 'key_status' => 'active']);
                    pc_log_activity(['user_id' => $uid, 'email' => $user->email,
                        'action' => 'manual_grant', 'result' => 'success',
                        'notes' => 'Dashboard quick-extend +10 days. New expiry: ' . $new_exp]);
                } elseif ($action === 'grant20') {
                    $new_total = (int) $user->credits_total + 20;
                    pc_update_user($uid, ['credits_total' => $new_total]);
                    pc_log_activity(['user_id' => $uid, 'email' => $user->email,
                        'action' => 'manual_grant', 'result' => 'success',
                        'credits_cost' => -20, 'credits_before' => (int)$user->credits_total, 'credits_after' => $new_total,
                        'notes' => 'Dashboard quick-grant +20 credits']);
                }
            }
        }
    }

    $today     = date('Y-m-d');
    $today_stats = pc_get_calls_in_window($today, $today);
    $total_users  = pc_get_user_count();
    $active_users = pc_get_user_count('active');
    $expired      = pc_get_user_count('expired') + pc_get_user_count('cancelled');

    // Count trials (plan=trial + active)
    global $wpdb;
    $trials_active = (int) $wpdb->get_var(
        "SELECT COUNT(*) FROM `{$wpdb->prefix}pc_users` WHERE plan='trial' AND key_status='active'"
    );

    $expiring_soon = pc_get_all_pc_users(['expiring_days' => 7]);
    $low_credit    = pc_get_all_pc_users(['low_credits_pct' => 10]);
    $recent_activity = pc_get_activity([], 20);

    $failed_today = $today_stats['failed_calls'];
    $calls_today  = $today_stats['total_calls'];
    $avg_dur      = $today_stats['total_calls'] > 0
        ? round($today_stats['total_duration_ms'] / $today_stats['total_calls'])
        : 0;

    // Credits consumed today
    $credits_today = (int) $wpdb->get_var($wpdb->prepare(
        "SELECT COALESCE(SUM(credits_cost),0) FROM `{$wpdb->prefix}pc_activity`
         WHERE action='deduct' AND DATE(created_at)=%s",
        $today
    ));

    // Revenue KPIs from payments table
    $rev_today = (int) $wpdb->get_var($wpdb->prepare(
        "SELECT COALESCE(SUM(amount_cents),0) FROM `{$wpdb->prefix}pc_payments` WHERE DATE(created_at)=%s AND status='succeeded'",
        $today
    ));
    $rev_month = (int) $wpdb->get_var($wpdb->prepare(
        "SELECT COALESCE(SUM(amount_cents),0) FROM `{$wpdb->prefix}pc_payments` WHERE DATE_FORMAT(created_at,'%%Y-%%m')=%s AND status='succeeded'",
        date('Y-m')
    ));
    $rev_total = (int) $wpdb->get_var(
        "SELECT COALESCE(SUM(amount_cents),0) FROM `{$wpdb->prefix}pc_payments` WHERE status='succeeded'"
    );
    ?>
    <div class="wrap">
        <h1>ProjectCare CRM — Dashboard</h1>
        <?php if (isset($_GET['updated'])): ?>
            <div class="notice notice-success is-dismissible"><p>Saved.</p></div>
        <?php endif; ?>

        <?php
        // Migration banner: if own table empty but FluentCRM has pc_api_key data
        if ($total_users === 0 && pc_fluentcrm_available()) {
            $fc_count = (int) $wpdb->get_var(
                "SELECT COUNT(DISTINCT subscriber_id) FROM `{$wpdb->prefix}fc_subscriber_meta` WHERE `key`='pc_api_key'"
            );
            if ($fc_count > 0): ?>
                <div class="notice notice-warning">
                    <p><strong>FluentCRM data detected.</strong>
                    <?php echo esc_html($fc_count); ?> user(s) found in FluentCRM but not yet imported.
                    <a href="<?php echo esc_url(admin_url('admin.php?page=pmc-crm-tools')); ?>">Run migration under Tools</a> to import your users.</p>
                </div>
            <?php endif;
        }
        ?>

        <style>
        .pmc-kpi-grid { display:flex; flex-wrap:wrap; gap:16px; margin:16px 0; }
        .pmc-kpi { background:#fff; border:1px solid #ddd; border-radius:6px; padding:16px 20px; min-width:160px; flex:1; }
        .pmc-kpi h3 { margin:0 0 4px; font-size:13px; color:#666; font-weight:normal; }
        .pmc-kpi .pmc-kpi-val { font-size:28px; font-weight:bold; color:#2271b1; }
        .pmc-section { background:#fff; border:1px solid #ddd; border-radius:6px; padding:16px; margin-bottom:20px; }
        .pmc-section h2 { margin-top:0; font-size:16px; border-bottom:1px solid #eee; padding-bottom:8px; }
        .pmc-result-success { color:#0a6b0a; }
        .pmc-result-fail, .pmc-result-error { color:#b32d2e; }
        </style>

        <div class="pmc-kpi-grid">
            <div class="pmc-kpi"><h3>Total Users</h3><div class="pmc-kpi-val"><?php echo esc_html($total_users); ?></div></div>
            <div class="pmc-kpi"><h3>Active Keys</h3><div class="pmc-kpi-val"><?php echo esc_html($active_users); ?></div></div>
            <div class="pmc-kpi"><h3>Trials Active</h3><div class="pmc-kpi-val"><?php echo esc_html($trials_active); ?></div></div>
            <div class="pmc-kpi"><h3>Expired / Cancelled</h3><div class="pmc-kpi-val"><?php echo esc_html($expired); ?></div></div>
        </div>
        <div class="pmc-kpi-grid">
            <div class="pmc-kpi"><h3>Credits Consumed Today</h3><div class="pmc-kpi-val"><?php echo esc_html($credits_today); ?></div></div>
            <div class="pmc-kpi"><h3>Calls Today</h3><div class="pmc-kpi-val"><?php echo esc_html($calls_today); ?></div></div>
            <div class="pmc-kpi"><h3>Avg Duration Today</h3><div class="pmc-kpi-val"><?php echo esc_html($avg_dur); ?>ms</div></div>
            <div class="pmc-kpi"><h3>Failed Calls Today</h3><div class="pmc-kpi-val" style="color:<?php echo $failed_today > 0 ? '#b32d2e' : '#0a6b0a'; ?>"><?php echo esc_html($failed_today); ?></div></div>
        </div>
        <div class="pmc-kpi-grid">
            <div class="pmc-kpi"><h3>Revenue Today</h3><div class="pmc-kpi-val">$<?php echo esc_html(number_format($rev_today / 100, 2)); ?></div></div>
            <div class="pmc-kpi"><h3>Revenue This Month</h3><div class="pmc-kpi-val">$<?php echo esc_html(number_format($rev_month / 100, 2)); ?></div></div>
            <div class="pmc-kpi"><h3>Revenue All-Time</h3><div class="pmc-kpi-val">$<?php echo esc_html(number_format($rev_total / 100, 2)); ?></div></div>
        </div>

        <!-- Action Queue -->
        <div class="pmc-section">
            <h2>Action Queue — Needs Attention</h2>

            <h3 style="font-size:14px">Expiring Within 7 Days (<?php echo count($expiring_soon); ?>)</h3>
            <?php if (empty($expiring_soon)): ?>
                <p style="color:#666">None.</p>
            <?php else: ?>
                <table class="widefat striped" style="max-width:700px">
                    <thead><tr><th>Email</th><th>Plan</th><th>Expires</th><th>Days Left</th><th>Action</th></tr></thead>
                    <tbody>
                    <?php foreach ($expiring_soon as $u):
                        $days_left = max(0, (int) ceil((strtotime($u->key_expires) - time()) / DAY_IN_SECONDS));
                    ?>
                        <tr>
                            <td><?php echo esc_html($u->email); ?></td>
                            <td><?php echo esc_html($u->plan); ?></td>
                            <td><?php echo esc_html($u->key_expires); ?></td>
                            <td><?php echo esc_html($days_left); ?></td>
                            <td>
                                <form method="post" style="display:inline">
                                    <?php wp_nonce_field('pc_quick_action_' . $u->id, 'pc_quick_nonce'); ?>
                                    <input type="hidden" name="pc_quick_uid"    value="<?php echo esc_attr($u->id); ?>">
                                    <input type="hidden" name="pc_quick_action" value="extend10">
                                    <button type="submit" class="button button-small">Extend +10 Days</button>
                                </form>
                            </td>
                        </tr>
                    <?php endforeach; ?>
                    </tbody>
                </table>
            <?php endif; ?>

            <h3 style="font-size:14px;margin-top:20px">Below 10% Credits (<?php echo count($low_credit); ?>)</h3>
            <?php if (empty($low_credit)): ?>
                <p style="color:#666">None.</p>
            <?php else: ?>
                <table class="widefat striped" style="max-width:700px">
                    <thead><tr><th>Email</th><th>Plan</th><th>Remaining</th><th>Total</th><th>Action</th></tr></thead>
                    <tbody>
                    <?php foreach ($low_credit as $u): ?>
                        <tr>
                            <td><?php echo esc_html($u->email); ?></td>
                            <td><?php echo esc_html($u->plan); ?></td>
                            <td style="color:#b32d2e;font-weight:bold"><?php echo esc_html($u->credits_remaining); ?></td>
                            <td><?php echo esc_html($u->credits_total); ?></td>
                            <td>
                                <form method="post" style="display:inline">
                                    <?php wp_nonce_field('pc_quick_action_' . $u->id, 'pc_quick_nonce'); ?>
                                    <input type="hidden" name="pc_quick_uid"    value="<?php echo esc_attr($u->id); ?>">
                                    <input type="hidden" name="pc_quick_action" value="grant20">
                                    <button type="submit" class="button button-small">Grant +20 Credits</button>
                                </form>
                            </td>
                        </tr>
                    <?php endforeach; ?>
                    </tbody>
                </table>
            <?php endif; ?>
        </div>

        <!-- Recent Activity Feed -->
        <div class="pmc-section">
            <h2>Recent Activity</h2>
            <?php if (empty($recent_activity)): ?>
                <p style="color:#666">No activity recorded yet.</p>
            <?php else: ?>
                <table class="widefat striped">
                    <thead><tr><th>Date</th><th>Email</th><th>Action</th><th>Credits</th><th>Result</th></tr></thead>
                    <tbody>
                    <?php foreach ($recent_activity as $row): ?>
                        <tr>
                            <td><?php echo esc_html($row->created_at); ?></td>
                            <td><?php echo esc_html($row->email ?: '—'); ?></td>
                            <td><?php echo esc_html($row->action); ?></td>
                            <td><?php echo $row->credits_cost ? esc_html($row->credits_cost) : '—'; ?></td>
                            <td class="pmc-result-<?php echo esc_attr($row->result); ?>"><?php echo esc_html($row->result); ?></td>
                        </tr>
                    <?php endforeach; ?>
                    </tbody>
                </table>
            <?php endif; ?>
        </div>
    </div>
    <?php
}
