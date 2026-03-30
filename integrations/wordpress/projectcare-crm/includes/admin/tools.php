<?php
defined('ABSPATH') || exit;

function pc_page_tools(): void {
    if (!current_user_can('manage_options')) return;

    $notice = '';

    // Export all users
    if (isset($_GET['export_users']) && $_GET['export_users'] === '1') {
        $users = pc_get_all_pc_users();
        header('Content-Type: text/csv');
        header('Content-Disposition: attachment; filename="pmc-users-full-' . date('Ymd') . '.csv"');
        $out = fopen('php://output', 'w');
        fputcsv($out, ['id','email','api_key','plan','credits_total','credits_used','credits_remaining','key_status','key_expires','stripe_customer_id','stripe_subscription_id','last_estimation','ip_address','source','created_at']);
        foreach ($users as $u) {
            fputcsv($out, [(int)$u->id,$u->email,$u->api_key,$u->plan,(int)$u->credits_total,(int)$u->credits_used,(int)$u->credits_remaining,$u->key_status,$u->key_expires,$u->stripe_customer_id,$u->stripe_subscription_id,$u->last_estimation,$u->ip_address,$u->source,$u->created_at]);
        }
        fclose($out);
        exit;
    }

    // Export activity
    if (isset($_GET['export_activity']) && $_GET['export_activity'] === '1') {
        $date_from = sanitize_text_field($_GET['act_from'] ?? date('Y-m-d', strtotime('-30 days')));
        $date_to   = sanitize_text_field($_GET['act_to']   ?? date('Y-m-d'));
        $rows = pc_get_activity(['date_from' => $date_from, 'date_to' => $date_to], 100000, 0);
        header('Content-Type: text/csv');
        header('Content-Disposition: attachment; filename="pmc-activity-' . date('Ymd') . '.csv"');
        $out = fopen('php://output', 'w');
        fputcsv($out, ['id','created_at','email','action','operation_type','credits_cost','credits_before','credits_after','duration_ms','gas_exec_count','ip_address','result','notes']);
        foreach ($rows as $r) {
            fputcsv($out, [(int)$r->id,$r->created_at,$r->email,$r->action,$r->operation_type,(int)$r->credits_cost,(int)$r->credits_before,(int)$r->credits_after,(int)$r->duration_ms,(int)$r->gas_exec_count,$r->ip_address,$r->result,$r->notes]);
        }
        fclose($out);
        exit;
    }

    // Export payments
    if (isset($_GET['export_payments']) && $_GET['export_payments'] === '1') {
        global $wpdb;
        $date_from = sanitize_text_field($_GET['pay_from'] ?? date('Y-m-d', strtotime('-12 months')));
        $date_to   = sanitize_text_field($_GET['pay_to']   ?? date('Y-m-d'));
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT * FROM `{$wpdb->prefix}pc_payments` WHERE DATE(created_at) BETWEEN %s AND %s ORDER BY created_at DESC LIMIT 100000",
            $date_from, $date_to
        )) ?: [];
        header('Content-Type: text/csv');
        header('Content-Disposition: attachment; filename="pmc-payments-' . date('Ymd') . '.csv"');
        $out = fopen('php://output', 'w');
        fputcsv($out, ['id','created_at','email','type','plan','amount_cents','amount_usd','currency','stripe_payment_intent','stripe_invoice_id','stripe_subscription_id','stripe_customer_id','stripe_price_id','stripe_product_id','stripe_charge_id','billing_reason','period_start','period_end','status','coupon_code']);
        foreach ($rows as $r) {
            fputcsv($out, [(int)$r->id,$r->created_at,$r->email,$r->type,$r->plan,(int)$r->amount_cents,number_format($r->amount_cents/100,2),$r->currency,$r->stripe_payment_intent,$r->stripe_invoice_id,$r->stripe_subscription_id,$r->stripe_customer_id,$r->stripe_price_id,$r->stripe_product_id,$r->stripe_charge_id,$r->billing_reason,$r->period_start,$r->period_end,$r->status,$r->coupon_code]);
        }
        fclose($out);
        exit;
    }

    // Migrate from FluentCRM
    $migration_report = null;
    if (isset($_POST['pc_migrate_nonce'])) {
        if (wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['pc_migrate_nonce'])), 'pc_migrate_fluentcrm')) {
            if (pc_fluentcrm_available()) {
                global $wpdb;
                $fc_meta = $wpdb->prefix . 'fc_subscriber_meta';
                $fc_subs = $wpdb->prefix . 'fc_subscribers';

                $rows = $wpdb->get_results(
                    "SELECT s.email, m.value AS api_key,
                        MAX(CASE WHEN m2.`key`='pc_plan' THEN m2.value END) AS plan,
                        MAX(CASE WHEN m2.`key`='pc_credits_total' THEN m2.value END) AS credits_total,
                        MAX(CASE WHEN m2.`key`='pc_credits_used' THEN m2.value END) AS credits_used,
                        MAX(CASE WHEN m2.`key`='pc_key_expires' THEN m2.value END) AS key_expires,
                        MAX(CASE WHEN m2.`key`='pc_key_status' THEN m2.value END) AS key_status
                     FROM `{$fc_subs}` s
                     INNER JOIN `{$fc_meta}` m  ON m.subscriber_id  = s.id AND m.`key`  = 'pc_api_key'
                     INNER JOIN `{$fc_meta}` m2 ON m2.subscriber_id = s.id
                     GROUP BY s.email, m.value"
                ) ?: [];

                $imported = $skipped = $errors = 0;
                foreach ($rows as $row) {
                    $email = strtolower(sanitize_email($row->email));
                    if (!is_email($email)) { $errors++; continue; }
                    $existing = pc_get_user_by_email($email);
                    if ($existing) { $skipped++; continue; }
                    $res = pc_create_user([
                        'email'         => $email,
                        'api_key'       => (string) ($row->api_key ?? ''),
                        'plan'          => (string) ($row->plan ?? 'trial'),
                        'credits_total' => (int)    ($row->credits_total ?? 0),
                        'credits_used'  => (int)    ($row->credits_used  ?? 0),
                        'key_expires'   => (string) ($row->key_expires   ?? ''),
                        'key_status'    => (string) ($row->key_status    ?? 'active'),
                        'source'        => 'import',
                    ]);
                    if ($res) $imported++; else $errors++;
                }
                $migration_report = compact('imported', 'skipped', 'errors');
                $notice = "Migration complete: {$imported} imported, {$skipped} skipped, {$errors} errors.";
            } else {
                $notice = 'FluentCRM is not available.';
            }
        }
    }

    // Prune activity
    $prune_notice = '';
    if (isset($_POST['pc_prune_nonce'], $_POST['prune_confirmed']) && (int)$_POST['prune_confirmed'] === 1) {
        if (wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['pc_prune_nonce'])), 'pc_prune_activity')) {
            $months = max(1, (int) ($_POST['prune_months'] ?? 13));
            $deleted = pc_prune_activity($months * 30);
            $prune_notice = 'Pruned ' . $deleted . ' activity rows older than ' . $months . ' month(s).';
        }
    }

    // Test email
    $email_notice = '';
    if (isset($_POST['pc_test_email_nonce'])) {
        if (wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['pc_test_email_nonce'])), 'pc_test_email')) {
            $to_addr = sanitize_email($_POST['test_email_addr'] ?? '');
            $tpl_slug = sanitize_text_field($_POST['test_tpl'] ?? 'trial_issued');
            if (is_email($to_addr)) {
                $dummy = ['email' => $to_addr, 'key' => 'test-key-abc123', 'plan' => 'Professional',
                    'credits' => '55', 'expiry' => date('Y-m-d', strtotime('+35 days')),
                    'upgrade_url' => pc_stripe_link(), 'credits_remaining' => '42', 'credits_total' => '55',
                    'site_name' => get_bloginfo('name')];
                $sent = pc_send_email($to_addr, $tpl_slug, $dummy);
                $email_notice = $sent ? 'Test email sent to ' . $to_addr : 'Failed to send test email.';
            } else {
                $email_notice = 'Invalid email address.';
            }
        }
    }

    // Ping
    $ping_result = null;
    if (isset($_POST['pc_tool_ping_nonce'])) {
        if (wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['pc_tool_ping_nonce'])), 'pc_tool_ping')) {
            $ping_result = pc_gas_ping();
        }
    }

    // Table row counts
    global $wpdb;
    $table_counts = [];
    foreach (['pc_users','pc_activity','pc_payments','pc_plans','pc_promo_codes','pc_email_templates','pc_webhook_log'] as $t) {
        $table_counts[$t] = (int) $wpdb->get_var("SELECT COUNT(*) FROM `{$wpdb->prefix}{$t}`");
    }

    $templates = $wpdb->get_results("SELECT slug, label FROM `{$wpdb->prefix}pc_email_templates` ORDER BY slug") ?: [];
    ?>
    <div class="wrap">
        <h1>ProjectCare CRM Tools</h1>
        <?php if ($notice): ?>
            <div class="notice notice-success is-dismissible"><p><?php echo esc_html($notice); ?></p></div>
        <?php endif; ?>
        <?php if ($prune_notice): ?>
            <div class="notice notice-info is-dismissible"><p><?php echo esc_html($prune_notice); ?></p></div>
        <?php endif; ?>
        <?php if ($email_notice): ?>
            <div class="notice notice-info is-dismissible"><p><?php echo esc_html($email_notice); ?></p></div>
        <?php endif; ?>

        <style>.pmc-tool { background:#fff;border:1px solid #ddd;border-radius:6px;padding:16px;margin-bottom:20px; }
        .pmc-tool h2 { margin-top:0;font-size:15px;border-bottom:1px solid #eee;padding-bottom:8px; }</style>

        <!-- FluentCRM Migration -->
        <div class="pmc-tool">
            <h2>Migrate from FluentCRM</h2>
            <?php if (!pc_fluentcrm_available()): ?>
                <p style="color:#666">FluentCRM is not active. Migration is unavailable.</p>
            <?php else: ?>
                <p>Scans <code>fc_subscriber_meta</code> for <code>pc_api_key</code> entries and imports matching users into <code>wp_pc_users</code>. Existing emails are skipped.</p>
                <form method="post">
                    <?php wp_nonce_field('pc_migrate_fluentcrm', 'pc_migrate_nonce'); ?>
                    <?php submit_button('Run Migration', 'primary', '', false); ?>
                </form>
                <?php if ($migration_report !== null): ?>
                    <p style="margin-top:12px"><strong>Result:</strong>
                    <?php echo esc_html($migration_report['imported']); ?> imported,
                    <?php echo esc_html($migration_report['skipped']); ?> skipped (already exist),
                    <?php echo esc_html($migration_report['errors']); ?> errors.</p>
                <?php endif; ?>
            <?php endif; ?>
        </div>

        <!-- Prune Activity Log -->
        <div class="pmc-tool">
            <h2>Prune Activity Log</h2>
            <form method="post">
                <?php wp_nonce_field('pc_prune_activity', 'pc_prune_nonce'); ?>
                <p><label>Delete activity events older than
                    <input type="number" name="prune_months" value="13" min="1" style="width:60px"> months
                </label></p>
                <p><label>
                    <input type="checkbox" name="prune_confirmed" value="1" required>
                    I confirm I want to permanently delete these rows
                </label></p>
                <?php submit_button('Prune Activity Log', 'delete', '', false); ?>
            </form>
        </div>

        <!-- Test Email -->
        <div class="pmc-tool">
            <h2>Test Email</h2>
            <form method="post">
                <?php wp_nonce_field('pc_test_email', 'pc_test_email_nonce'); ?>
                <p>
                    <label>Send to: <input type="email" name="test_email_addr" value="<?php echo esc_attr(get_option('admin_email')); ?>" class="regular-text"></label>
                </p>
                <p>
                    <label>Template:
                        <select name="test_tpl">
                            <?php foreach ($templates as $t): ?>
                                <option value="<?php echo esc_attr($t->slug); ?>"><?php echo esc_html($t->label . ' (' . $t->slug . ')'); ?></option>
                            <?php endforeach; ?>
                        </select>
                    </label>
                </p>
                <?php submit_button('Send Test Email', 'secondary', '', false); ?>
            </form>
        </div>

        <!-- Ping GAS -->
        <div class="pmc-tool">
            <h2>Ping GAS</h2>
            <form method="post">
                <?php wp_nonce_field('pc_tool_ping', 'pc_tool_ping_nonce'); ?>
                <?php submit_button('Ping GAS Endpoint', 'secondary', '', false); ?>
            </form>
            <?php if ($ping_result !== null): ?>
                <div style="margin-top:12px;padding:10px;background:#f0f8ff;border:1px solid #cce">
                    <strong>Status:</strong> <?php echo $ping_result['ok'] ? '<span style="color:#0a6b0a">OK</span>' : '<span style="color:#b32d2e">FAIL</span>'; ?><br>
                    <strong>Latency:</strong> <?php echo esc_html($ping_result['latency_ms']); ?>ms<br>
                    <?php if ($ping_result['error']): ?><strong>Error:</strong> <?php echo esc_html($ping_result['error']); ?><br><?php endif; ?>
                    <?php if ($ping_result['response']): ?><pre style="font-size:11px;overflow:auto;max-height:200px"><?php echo esc_html(wp_json_encode($ping_result['response'], JSON_PRETTY_PRINT)); ?></pre><?php endif; ?>
                </div>
            <?php endif; ?>
        </div>

        <!-- Export users -->
        <div class="pmc-tool">
            <h2>Export All Users CSV</h2>
            <p>Downloads a CSV of the full <code>wp_pc_users</code> table including API keys.</p>
            <a href="<?php echo esc_url(add_query_arg(['export_users' => '1'], admin_url('admin.php?page=pmc-crm-tools'))); ?>" class="button">Download Users CSV</a>
        </div>

        <!-- Export activity -->
        <div class="pmc-tool">
            <h2>Export Activity Log CSV</h2>
            <form method="get" action="<?php echo esc_url(admin_url('admin.php')); ?>">
                <input type="hidden" name="page" value="pmc-crm-tools">
                <input type="hidden" name="export_activity" value="1">
                <p>
                    <label>From: <input type="date" name="act_from" value="<?php echo esc_attr(date('Y-m-d', strtotime('-30 days'))); ?>"></label>
                    <label style="margin-left:12px">To: <input type="date" name="act_to" value="<?php echo esc_attr(date('Y-m-d')); ?>"></label>
                </p>
                <button type="submit" class="button">Download Activity CSV</button>
            </form>
        </div>

        <!-- Export payments -->
        <div class="pmc-tool">
            <h2>Export Payments CSV</h2>
            <p>Downloads all Stripe payment records with full IDs (payment intent, invoice, subscription, price, product, charge).</p>
            <form method="get" action="<?php echo esc_url(admin_url('admin.php')); ?>">
                <input type="hidden" name="page" value="pmc-crm-tools">
                <input type="hidden" name="export_payments" value="1">
                <p>
                    <label>From: <input type="date" name="pay_from" value="<?php echo esc_attr(date('Y-m-d', strtotime('-12 months'))); ?>"></label>
                    <label style="margin-left:12px">To: <input type="date" name="pay_to" value="<?php echo esc_attr(date('Y-m-d')); ?>"></label>
                </p>
                <button type="submit" class="button">Download Payments CSV</button>
            </form>
        </div>

        <!-- Database status -->
        <div class="pmc-tool">
            <h2>Database Status</h2>
            <p>Plugin version: <strong><?php echo esc_html(PC_CRM_VERSION); ?></strong></p>
            <table class="widefat" style="max-width:400px">
                <thead><tr><th>Table</th><th>Rows</th></tr></thead>
                <tbody>
                <?php foreach ($table_counts as $tname => $cnt): ?>
                    <tr><td><code><?php echo esc_html($wpdb->prefix . $tname); ?></code></td><td><?php echo esc_html(number_format($cnt)); ?></td></tr>
                <?php endforeach; ?>
                </tbody>
            </table>
        </div>
    </div>
    <?php
}
