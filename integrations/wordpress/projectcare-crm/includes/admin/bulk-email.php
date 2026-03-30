<?php
defined('ABSPATH') || exit;

function pc_page_bulk_email(): void {
    if (!current_user_can('manage_options')) return;

    global $wpdb;

    $notice     = '';
    $sent_count = 0;
    $fail_count = 0;

    // ── Send POST ─────────────────────────────────────────────────────────────
    if (isset($_POST['pc_bulk_email_nonce'])) {
        if (wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['pc_bulk_email_nonce'])), 'pc_bulk_email_send')) {
            $raw_ids  = sanitize_text_field($_POST['user_ids_list'] ?? '');
            $tpl_slug = sanitize_text_field($_POST['bulk_tpl'] ?? '');
            $user_ids = array_filter(array_map('intval', explode(',', $raw_ids)));

            if (empty($user_ids)) {
                $notice = 'No users selected.';
            } elseif (empty($tpl_slug)) {
                $notice = 'Select a template.';
            } else {
                foreach ($user_ids as $uid) {
                    $u = pc_get_user_by_id($uid);
                    if (!$u) continue;
                    $vars = [
                        'email'             => $u->email,
                        'key'               => $u->api_key,
                        'plan'              => $u->plan,
                        'credits'           => pc_credits_remaining($u),
                        'credits_remaining' => pc_credits_remaining($u),
                        'credits_total'     => $u->credits_total,
                        'expiry'            => $u->key_expires,
                        'upgrade_url'       => pc_stripe_link(),
                        'site_name'         => get_bloginfo('name'),
                    ];
                    $ok = pc_send_email($u->email, $tpl_slug, $vars);
                    if ($ok) { $sent_count++; } else { $fail_count++; }
                }
                $notice = "Sent: {$sent_count} succeeded, {$fail_count} failed.";
            }
        }
    }

    // ── Resolve user list ─────────────────────────────────────────────────────
    $raw_ids  = sanitize_text_field($_GET['user_ids'] ?? $_POST['user_ids_list'] ?? '');
    $user_ids = array_unique(array_filter(array_map('intval', explode(',', $raw_ids))));
    $users    = [];
    foreach ($user_ids as $uid) {
        $u = pc_get_user_by_id($uid);
        if ($u) $users[] = $u;
    }

    $templates = $wpdb->get_results(
        "SELECT slug, label FROM `{$wpdb->prefix}pc_email_templates` WHERE is_active=1 ORDER BY label"
    ) ?: [];

    $back_url = admin_url('admin.php?page=pmc-crm-users');
    ?>
    <div class="wrap">
        <h1>Bulk Email
            <a href="<?php echo esc_url($back_url); ?>" class="page-title-action">&larr; Back to Users</a>
        </h1>

        <?php if ($notice): ?>
            <div class="notice notice-<?php echo strpos($notice, 'failed') !== false && $fail_count > 0 ? 'warning' : 'success'; ?> is-dismissible">
                <p><?php echo esc_html($notice); ?></p>
            </div>
        <?php endif; ?>

        <?php if (empty($users)): ?>
            <div style="padding:30px;text-align:center;background:#f9f9f9;border:1px solid #ddd;border-radius:6px;color:#666">
                <p>No users selected. Go back to <a href="<?php echo esc_url(admin_url('admin.php?page=pmc-crm-users')); ?>">Users</a>, check some rows, and choose "Send Email" from the bulk actions dropdown.</p>
            </div>
        <?php else: ?>

        <div style="display:grid;grid-template-columns:1fr 1.5fr;gap:24px;margin-top:16px;align-items:start">

            <!-- Recipient list -->
            <div style="background:#fff;border:1px solid #ddd;border-radius:6px;padding:16px">
                <h2 style="margin-top:0;font-size:14px;font-weight:600">Recipients (<?php echo count($users); ?>)</h2>
                <table class="widefat striped" style="font-size:12px">
                    <thead><tr><th>Email</th><th>Plan</th><th>Status</th></tr></thead>
                    <tbody>
                    <?php foreach ($users as $u):
                        $is_exp = $u->key_expires && strtotime($u->key_expires) < time();
                    ?>
                        <tr>
                            <td><?php echo esc_html($u->email); ?></td>
                            <td><?php echo pc_plan_badge($u->plan); ?></td>
                            <td><?php echo pc_status_badge($u->key_status, $is_exp); ?></td>
                        </tr>
                    <?php endforeach; ?>
                    </tbody>
                </table>
            </div>

            <!-- Compose form -->
            <div style="background:#fff;border:1px solid #ddd;border-radius:6px;padding:16px">
                <h2 style="margin-top:0;font-size:14px;font-weight:600">Compose</h2>
                <form method="post">
                    <?php wp_nonce_field('pc_bulk_email_send', 'pc_bulk_email_nonce'); ?>
                    <input type="hidden" name="user_ids_list" value="<?php echo esc_attr(implode(',', array_column($users, 'id'))); ?>">

                    <p>
                        <label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Template</label>
                        <?php if (empty($templates)): ?>
                            <em style="color:#666">No active email templates found. <a href="<?php echo esc_url(admin_url('admin.php?page=pmc-crm-email-templates')); ?>">Create one</a>.</em>
                        <?php else: ?>
                            <select name="bulk_tpl" style="width:100%;font-size:13px">
                                <option value="">— Select a template —</option>
                                <?php foreach ($templates as $t): ?>
                                    <option value="<?php echo esc_attr($t->slug); ?>"><?php echo esc_html($t->label . ' (' . $t->slug . ')'); ?></option>
                                <?php endforeach; ?>
                            </select>
                        <?php endif; ?>
                    </p>

                    <div style="background:#fff8e1;border:1px solid #f0c040;border-radius:4px;padding:10px;font-size:12px;color:#7a4f00;margin:12px 0">
                        <strong>Variables injected per user:</strong> <code>{{email}}</code>, <code>{{key}}</code>, <code>{{plan}}</code>, <code>{{credits_remaining}}</code>, <code>{{expiry}}</code>, <code>{{upgrade_url}}</code>
                    </div>

                    <?php if (!empty($templates)): ?>
                        <p style="font-size:13px;color:#444">Sending to <strong><?php echo count($users); ?></strong> recipient(s). Each receives a personalized copy.</p>
                        <?php submit_button('Send to ' . count($users) . ' User(s)', 'primary', '', false,
                            ['onclick' => 'return confirm("Send email to ' . count($users) . ' user(s)? This cannot be undone.")']); ?>
                    <?php endif; ?>
                </form>
            </div>
        </div>

        <?php endif; ?>
    </div>
    <?php
}
