<?php
defined('ABSPATH') || exit;

function pc_render_user_detail(int $user_id): void {
    if (!current_user_can('manage_options')) return;

    $user = pc_get_user_by_id($user_id);
    if (!$user) {
        echo '<div class="wrap"><p>User not found.</p><a href="' . esc_url(admin_url('admin.php?page=pmc-crm-users')) . '">&larr; Back to Users</a></div>';
        return;
    }

    $notice     = '';
    $active_tab = 'overview'; // default; overridden after POST

    $return_url = wp_validate_redirect(
        esc_url_raw(wp_unslash($_GET['return_url'] ?? '')),
        admin_url('admin.php?page=pmc-crm-users')
    );
    $self_url = admin_url('admin.php?page=pmc-crm-users&user_id=' . $user_id . '&return_url=' . urlencode($return_url));

    // ── Main edit form ────────────────────────────────────────────────────────
    if (isset($_POST['pc_edit_nonce'])) {
        if (wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['pc_edit_nonce'])), 'pc_edit_user_' . $user_id)) {
            pc_update_user($user_id, [
                'plan'          => sanitize_text_field($_POST['pc_plan']          ?? $user->plan),
                'credits_total' => (int) ($_POST['pc_credits_total'] ?? $user->credits_total),
                'credits_used'  => (int) ($_POST['pc_credits_used']  ?? $user->credits_used),
                'key_expires'   => sanitize_text_field($_POST['pc_key_expires']  ?? $user->key_expires),
                'key_status'    => sanitize_text_field($_POST['pc_key_status']   ?? $user->key_status),
                'notes'         => sanitize_textarea_field($_POST['pc_notes'] ?? ''),
            ]);
            pc_log_activity(['user_id' => $user_id, 'email' => $user->email,
                'action' => 'admin_edit', 'result' => 'success', 'notes' => 'Admin edited user profile']);
            $user       = pc_get_user_by_id($user_id);
            $notice     = 'User updated.';
            $active_tab = 'edit';
        }
    }

    // ── Quick actions ─────────────────────────────────────────────────────────
    if (isset($_POST['pc_quick_nonce'], $_POST['pc_action'])) {
        $action = sanitize_text_field($_POST['pc_action']);
        if (wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['pc_quick_nonce'])), 'pc_quick_action_' . $user_id)) {
            switch ($action) {
                case 'reset':
                    $reset_updates = ['credits_used' => 0, 'key_status' => 'active'];
                    $reset_exp_ts = $user->key_expires ? strtotime($user->key_expires) : false;
                    if (!$reset_exp_ts || $reset_exp_ts < time()) {
                        $reset_updates['key_expires'] = date('Y-m-d', strtotime('+30 days'));
                    }
                    pc_update_user($user_id, $reset_updates);
                    pc_log_activity(['user_id' => $user_id, 'email' => $user->email, 'action' => 'admin_edit',
                        'result' => 'success', 'notes' => 'Reset usage + activated'
                            . (isset($reset_updates['key_expires']) ? ' + extended to ' . $reset_updates['key_expires'] : '')]);
                    $notice = 'Usage reset and key activated.'
                        . (isset($reset_updates['key_expires']) ? ' Extended to ' . $reset_updates['key_expires'] . '.' : '');
                    break;
                case 'extend7':
                    $new_exp = date('Y-m-d', strtotime(($user->key_expires ?: 'now') . ' +7 days'));
                    pc_update_user($user_id, ['key_expires' => $new_exp, 'key_status' => 'active']);
                    pc_log_activity(['user_id' => $user_id, 'email' => $user->email, 'action' => 'manual_grant',
                        'result' => 'success', 'notes' => 'Extended +7 days. New expiry: ' . $new_exp]);
                    $notice = 'Extended +7 days. New expiry: ' . $new_exp;
                    break;
                case 'extend30':
                    $new_exp = date('Y-m-d', strtotime(($user->key_expires ?: 'now') . ' +30 days'));
                    pc_update_user($user_id, ['key_expires' => $new_exp, 'key_status' => 'active']);
                    pc_log_activity(['user_id' => $user_id, 'email' => $user->email, 'action' => 'manual_grant',
                        'result' => 'success', 'notes' => 'Extended +30 days. New expiry: ' . $new_exp]);
                    $notice = 'Extended +30 days. New expiry: ' . $new_exp;
                    break;
                case 'grant10':
                case 'grant25':
                case 'grant50':
                    $amt       = (int) substr($action, 5);
                    $new_total = (int) $user->credits_total + $amt;
                    pc_update_user($user_id, ['credits_total' => $new_total]);
                    pc_log_activity(['user_id' => $user_id, 'email' => $user->email,
                        'action' => 'manual_grant', 'credits_cost' => -$amt,
                        'credits_before' => (int) $user->credits_total, 'credits_after' => $new_total,
                        'result' => 'success', 'notes' => 'Manual grant +' . $amt . ' credits']);
                    $notice = 'Granted +' . $amt . ' credits. New total: ' . $new_total;
                    break;
                case 'activate':
                    $act_updates = ['key_status' => 'active'];
                    $exp_ts = $user->key_expires ? strtotime($user->key_expires) : false;
                    if (!$exp_ts || $exp_ts < time()) {
                        $act_updates['key_expires'] = date('Y-m-d', strtotime('+30 days'));
                    }
                    pc_update_user($user_id, $act_updates);
                    pc_log_activity(['user_id' => $user_id, 'email' => $user->email, 'action' => 'admin_edit',
                        'result' => 'success', 'notes' => 'Admin activated key'
                            . (isset($act_updates['key_expires']) ? ' + extended to ' . $act_updates['key_expires'] : '')]);
                    $notice = isset($act_updates['key_expires'])
                        ? 'Key activated and extended to ' . $act_updates['key_expires'] . '.'
                        : 'Key activated.';
                    break;
                case 'deactivate':
                    pc_update_user($user_id, ['key_status' => 'inactive']);
                    pc_log_activity(['user_id' => $user_id, 'email' => $user->email, 'action' => 'admin_edit',
                        'result' => 'success', 'notes' => 'Admin deactivated key']);
                    $notice = 'Key deactivated.';
                    break;
                case 'suspend':
                    pc_update_user($user_id, ['key_status' => 'suspended']);
                    pc_log_activity(['user_id' => $user_id, 'email' => $user->email, 'action' => 'suspension',
                        'result' => 'success', 'notes' => 'Admin suspended key']);
                    $notice = 'Key suspended.';
                    break;
                case 'regen_key':
                    $new_key = bin2hex(random_bytes(32));
                    $regen_updates = ['api_key' => $new_key, 'key_status' => 'active'];
                    $regen_exp_ts = $user->key_expires ? strtotime($user->key_expires) : false;
                    if (!$regen_exp_ts || $regen_exp_ts < time()) {
                        $regen_updates['key_expires'] = date('Y-m-d', strtotime('+30 days'));
                    }
                    pc_update_user($user_id, $regen_updates);
                    pc_log_activity(['user_id' => $user_id, 'email' => $user->email, 'action' => 'key_regen',
                        'result' => 'success', 'notes' => 'Admin regenerated API key']);
                    pc_send_email($user->email, 'key_regen', [
                        'email'  => $user->email,
                        'key'    => $new_key,
                        'plan'   => $user->plan,
                        'expiry' => $regen_updates['key_expires'] ?? $user->key_expires,
                    ]);
                    $notice = 'Key regenerated and email sent.';
                    break;
            }
            $user = pc_get_user_by_id($user_id);
        }
    }

    // ── Send email ────────────────────────────────────────────────────────────
    if (isset($_POST['pc_send_email_nonce'])) {
        if (wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['pc_send_email_nonce'])), 'pc_send_email_' . $user_id)) {
            $tpl_slug = sanitize_text_field($_POST['pc_email_template'] ?? '');
            if ($tpl_slug === 'custom') {
                $subj = sanitize_text_field($_POST['pc_custom_subject'] ?? 'PMC Notification');
                $body = wp_kses_post($_POST['pc_custom_body'] ?? '');
                $sent = wp_mail($user->email, $subj, $body, ['Content-Type: text/html; charset=UTF-8']);
                pc_log_activity(['user_id' => $user_id, 'email' => $user->email, 'action' => 'email_sent',
                    'result' => $sent ? 'success' : 'fail', 'notes' => 'Admin custom email: ' . mb_substr($subj, 0, 80)]);
            } else {
                $sent = pc_send_email($user->email, $tpl_slug, [
                    'email'             => $user->email,
                    'key'               => $user->api_key,
                    'plan'              => $user->plan,
                    'credits'           => pc_credits_remaining($user),
                    'expiry'            => $user->key_expires,
                    'credits_remaining' => pc_credits_remaining($user),
                    'credits_total'     => $user->credits_total,
                    'site_name'         => get_bloginfo('name'),
                    'upgrade_url'       => pc_stripe_link(),
                ]);
            }
            $notice     = $sent ? 'Email sent.' : 'Email failed to send.';
            $active_tab = 'email';
        }
    }

    // ── Reload fresh data ─────────────────────────────────────────────────────
    $user = pc_get_user_by_id($user_id);
    if (!$user) return;

    $remaining  = pc_credits_remaining($user);
    $total_c    = (int) $user->credits_total;
    $is_expired = $user->key_expires && strtotime($user->key_expires) < time();
    $plans      = pc_get_plans();

    global $wpdb;
    $tpl_rows = $wpdb->get_results(
        "SELECT slug, label FROM `{$wpdb->prefix}pc_email_templates` ORDER BY slug"
    ) ?: [];

    $activity    = pc_get_activity(['user_id' => $user_id], 50);
    $act_count   = pc_get_activity_count(['user_id' => $user_id]);
    $est_count   = pc_get_activity_count(['user_id' => $user_id, 'action' => 'deduct']);

    $payments = $wpdb->get_results($wpdb->prepare(
        "SELECT * FROM `{$wpdb->prefix}pc_payments` WHERE user_id=%d OR email=%s ORDER BY created_at DESC LIMIT 50",
        $user_id, $user->email
    )) ?: [];

    // Journey card computed values
    $days_member = max(0, (int) ((time() - strtotime($user->created_at)) / 86400));
    $expiry_ts   = $user->key_expires ? strtotime($user->key_expires) : null;
    $days_left   = $expiry_ts ? (int) (($expiry_ts - time()) / 86400) : null;

    if ($is_expired) {
        $expiry_label = 'Expired ' . abs((int)(($expiry_ts - time()) / 86400)) . ' days ago';
        $expiry_color = '#991b1b';
    } elseif ($days_left !== null && $days_left <= 7) {
        $expiry_label = 'Expires in ' . $days_left . ' day(s)';
        $expiry_color = '#92400e';
    } elseif ($days_left !== null) {
        $expiry_label = 'Expires ' . esc_html($user->key_expires) . ' (' . $days_left . 'd)';
        $expiry_color = '#374151';
    } else {
        $expiry_label = 'No expiry set';
        $expiry_color = '#999';
    }

    $cred_pct   = $total_c > 0 ? min(100, (int) round($remaining / $total_c * 100)) : 0;
    $cred_color = $cred_pct <= 0 ? '#b32d2e' : ($cred_pct < 10 ? '#c05600' : ($cred_pct < 25 ? '#f0a500' : '#0a6b0a'));
    ?>
    <div class="wrap">

        <!-- Header -->
        <div style="display:flex;align-items:baseline;gap:16px;flex-wrap:wrap;margin-bottom:4px">
            <h1 style="margin:0"><?php echo esc_html($user->email); ?></h1>
            <?php echo pc_plan_badge($user->plan); ?>
            <?php echo pc_status_badge($user->key_status, $is_expired); ?>
        </div>
        <p style="margin-top:6px">
            <a href="<?php echo esc_url($return_url); ?>" style="color:#2271b1;text-decoration:none">&larr; Back to Users</a>
        </p>

        <?php if ($notice): ?>
            <div class="notice notice-success is-dismissible"><p><?php echo esc_html($notice); ?></p></div>
        <?php endif; ?>

        <!-- Journey summary card -->
        <div style="background:#fff;border:1px solid #ddd;border-radius:8px;padding:16px 20px;margin-bottom:20px">
            <div style="display:flex;flex-wrap:wrap;gap:24px;align-items:center">

                <!-- Credits bar -->
                <div style="flex:1;min-width:200px">
                    <div style="font-size:11px;color:#666;margin-bottom:4px;font-weight:600;text-transform:uppercase;letter-spacing:.04em">Credits Remaining</div>
                    <div style="height:8px;background:#e5e7eb;border-radius:4px;overflow:hidden;margin-bottom:5px">
                        <div style="height:100%;width:<?php echo esc_attr($cred_pct); ?>%;background:<?php echo esc_attr($cred_color); ?>;border-radius:4px"></div>
                    </div>
                    <div style="font-size:18px;font-weight:700;color:<?php echo esc_attr($cred_color); ?>"><?php echo esc_html($remaining); ?> <span style="font-size:13px;color:#666;font-weight:400">/ <?php echo esc_html($total_c); ?> (<?php echo esc_html($cred_pct); ?>%)</span></div>
                </div>

                <!-- Key stats -->
                <div style="display:flex;flex-wrap:wrap;gap:20px">
                    <div style="text-align:center">
                        <div style="font-size:20px;font-weight:700;color:#1d2327"><?php echo esc_html($days_member); ?></div>
                        <div style="font-size:11px;color:#666">days as member</div>
                    </div>
                    <div style="text-align:center">
                        <div style="font-size:20px;font-weight:700;color:#1d2327"><?php echo esc_html($est_count); ?></div>
                        <div style="font-size:11px;color:#666">estimations run</div>
                    </div>
                    <div style="text-align:center">
                        <div style="font-size:20px;font-weight:700;color:#1d2327"><?php echo esc_html(count($payments)); ?></div>
                        <div style="font-size:11px;color:#666">payments</div>
                    </div>
                    <div style="text-align:center">
                        <div style="font-size:14px;font-weight:600;color:<?php echo esc_attr($expiry_color); ?>"><?php echo esc_html($expiry_label); ?></div>
                        <div style="font-size:11px;color:#666">key expiry</div>
                    </div>
                    <div style="text-align:center">
                        <div style="font-size:14px;font-weight:600;color:#374151"><?php echo esc_html(pc_relative_time($user->last_estimation)); ?></div>
                        <div style="font-size:11px;color:#666">last active</div>
                    </div>
                    <div style="text-align:center">
                        <div style="font-size:13px;color:#374151"><?php echo esc_html($user->source ?: '—'); ?></div>
                        <div style="font-size:11px;color:#666">signup source</div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Tabs -->
        <div class="pmc-tabs" data-initial="<?php echo esc_attr($active_tab); ?>">

            <nav style="display:flex;border-bottom:2px solid #ddd;margin-bottom:20px;gap:0;flex-wrap:wrap">
                <?php
                $tab_defs = [
                    ['overview',  'Overview'],
                    ['edit',      'Edit'],
                    ['activity',  'Activity (' . $act_count . ')'],
                    ['payments',  'Payments (' . count($payments) . ')'],
                    ['email',     'Send Email'],
                ];
                foreach ($tab_defs as [$tid, $tlabel]):
                ?>
                <button type="button" class="pmc-tab-btn" data-tab="<?php echo esc_attr($tid); ?>"
                    style="background:none;border:none;border-bottom:2px solid transparent;padding:10px 18px;cursor:pointer;font-size:13px;margin-bottom:-2px;color:#1d2327;white-space:nowrap">
                    <?php echo esc_html($tlabel); ?>
                </button>
                <?php endforeach; ?>
            </nav>

            <!-- TAB: Overview -->
            <div id="pmc-tab-overview" class="pmc-tab-panel">

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">

                    <!-- Profile -->
                    <div style="background:#fff;border:1px solid #ddd;border-radius:6px;padding:16px">
                        <h2 style="margin-top:0;font-size:14px;font-weight:600">Profile</h2>
                        <table class="widefat" style="border:0;font-size:13px">
                            <tr><th style="width:120px">Email</th><td><?php echo esc_html($user->email); ?></td></tr>
                            <tr><th>User ID</th><td><?php echo esc_html($user->id); ?></td></tr>
                            <tr><th>Source</th><td><?php echo esc_html($user->source ?: '—'); ?></td></tr>
                            <tr><th>Joined</th><td><?php echo esc_html($user->created_at ? substr($user->created_at, 0, 10) : '—'); ?></td></tr>
                            <tr><th>IP Address</th><td><?php echo esc_html($user->ip_address ?: '—'); ?></td></tr>
                            <?php if ($user->stripe_customer_id): ?>
                            <tr><th>Stripe Customer</th><td><code style="font-size:11px"><?php echo esc_html($user->stripe_customer_id); ?></code></td></tr>
                            <?php endif; ?>
                            <?php if ($user->stripe_subscription_id): ?>
                            <tr><th>Stripe Sub</th><td><code style="font-size:11px"><?php echo esc_html($user->stripe_subscription_id); ?></code></td></tr>
                            <?php endif; ?>
                            <?php if ($user->notes): ?>
                            <tr><th>Notes</th><td style="white-space:pre-wrap;font-size:12px;color:#555"><?php echo esc_html($user->notes); ?></td></tr>
                            <?php endif; ?>
                        </table>
                    </div>

                    <!-- API Key -->
                    <div style="background:#fff;border:1px solid #ddd;border-radius:6px;padding:16px">
                        <h2 style="margin-top:0;font-size:14px;font-weight:600">API Key</h2>
                        <p style="margin-bottom:10px">
                            <label style="font-size:13px"><input type="checkbox" id="pmc-show-key"> Show full key</label><br>
                            <code id="pmc-key-masked" style="font-size:12px;word-break:break-all"><?php echo esc_html(substr($user->api_key, 0, 12) . '…' . substr($user->api_key, -8)); ?></code>
                            <code id="pmc-key-full" style="font-size:12px;word-break:break-all;display:none"><?php echo esc_html($user->api_key); ?></code>
                        </p>
                        <form method="post">
                            <?php wp_nonce_field('pc_quick_action_' . $user_id, 'pc_quick_nonce'); ?>
                            <input type="hidden" name="pc_action" value="regen_key">
                            <button type="submit" class="button" onclick="return confirm('Regenerate key? The old key stops working immediately.')">Regenerate Key + Email User</button>
                        </form>
                    </div>
                </div>

                <!-- Quick actions -->
                <div style="background:#fff;border:1px solid #ddd;border-radius:6px;padding:16px;margin-bottom:20px">
                    <h2 style="margin-top:0;font-size:14px;font-weight:600">Quick Actions</h2>
                    <div style="display:flex;flex-wrap:wrap;gap:8px">
                        <?php
                        $quick_actions = [
                            ['activate',   'Activate',                   false],
                            ['deactivate', 'Deactivate',                 true],
                            ['suspend',    'Suspend',                    true],
                            ['reset',      'Reset Usage',                false],
                            ['extend7',    'Extend +7 Days',             false],
                            ['extend30',   'Extend +30 Days',            false],
                            ['grant10',    'Grant +10 Credits',          false],
                            ['grant25',    'Grant +25 Credits',          false],
                            ['grant50',    'Grant +50 Credits',          false],
                        ];
                        foreach ($quick_actions as [$act, $lbl, $danger]):
                            $onclick = $danger ? ' onclick="return confirm(\'Are you sure?\')"' : '';
                        ?>
                        <form method="post" style="display:inline">
                            <?php wp_nonce_field('pc_quick_action_' . $user_id, 'pc_quick_nonce'); ?>
                            <input type="hidden" name="pc_action" value="<?php echo esc_attr($act); ?>">
                            <button type="submit" class="button<?php echo $danger ? ' button-link-delete' : ''; ?>"<?php echo $onclick; ?>><?php echo esc_html($lbl); ?></button>
                        </form>
                        <?php endforeach; ?>
                    </div>
                </div>

            </div><!-- /overview -->

            <!-- TAB: Edit -->
            <div id="pmc-tab-edit" class="pmc-tab-panel" style="display:none">
                <div style="background:#fff;border:1px solid #ddd;border-radius:6px;padding:20px;max-width:600px">
                    <h2 style="margin-top:0;font-size:14px;font-weight:600">Edit User</h2>
                    <form method="post">
                        <?php wp_nonce_field('pc_edit_user_' . $user_id, 'pc_edit_nonce'); ?>
                        <table class="form-table" role="presentation">
                            <tr>
                                <th><label for="f_plan">Plan</label></th>
                                <td>
                                    <select name="pc_plan" id="f_plan">
                                        <?php foreach ($plans as $p): ?>
                                            <option value="<?php echo esc_attr($p['slug']); ?>" <?php selected($user->plan, $p['slug']); ?>>
                                                <?php echo esc_html($p['label']); ?>
                                            </option>
                                        <?php endforeach; ?>
                                    </select>
                                </td>
                            </tr>
                            <tr>
                                <th><label for="f_total">Credits Total</label></th>
                                <td><input type="number" id="f_total" name="pc_credits_total" value="<?php echo esc_attr($user->credits_total); ?>" min="0" class="small-text"></td>
                            </tr>
                            <tr>
                                <th><label for="f_used">Credits Used</label></th>
                                <td>
                                    <input type="number" id="f_used" name="pc_credits_used" value="<?php echo esc_attr($user->credits_used); ?>" min="0" class="small-text">
                                    <p class="description">Set to 0 to fully reset usage.</p>
                                </td>
                            </tr>
                            <tr>
                                <th><label for="f_expires">Key Expires</label></th>
                                <td><input type="date" id="f_expires" name="pc_key_expires" value="<?php echo esc_attr($user->key_expires ?? ''); ?>"></td>
                            </tr>
                            <tr>
                                <th><label for="f_status">Key Status</label></th>
                                <td>
                                    <select name="pc_key_status" id="f_status">
                                        <?php foreach (['active','inactive','expired','suspended','cancelled','superseded'] as $st): ?>
                                            <option value="<?php echo esc_attr($st); ?>" <?php selected($user->key_status, $st); ?>><?php echo esc_html(ucfirst($st)); ?></option>
                                        <?php endforeach; ?>
                                    </select>
                                </td>
                            </tr>
                            <tr>
                                <th><label for="f_notes">Admin Notes</label></th>
                                <td><textarea id="f_notes" name="pc_notes" rows="4" cols="50"><?php echo esc_textarea($user->notes ?? ''); ?></textarea></td>
                            </tr>
                        </table>
                        <?php submit_button('Save Changes', 'primary', '', false); ?>
                    </form>
                </div>
            </div><!-- /edit -->

            <!-- TAB: Activity -->
            <div id="pmc-tab-activity" class="pmc-tab-panel" style="display:none">
                <?php if (empty($activity)): ?>
                    <p style="color:#666">No activity yet.</p>
                <?php else: ?>
                    <table class="widefat striped" style="font-size:12px">
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Event</th>
                                <th>Cost</th>
                                <th>Credits After</th>
                                <th>Duration</th>
                                <th>IP</th>
                                <th>Result</th>
                                <th>Notes</th>
                            </tr>
                        </thead>
                        <tbody>
                        <?php foreach ($activity as $row):
                            // Merged event label: show operation_type for deduct, action for everything else
                            $event_label = ($row->action === 'deduct' && $row->operation_type)
                                ? $row->operation_type
                                : $row->action;
                            $res_color  = $row->result === 'success' ? '#0a6b0a' : '#b32d2e';
                            $notes_full = $row->notes ?? '';
                        ?>
                            <tr>
                                <td style="white-space:nowrap"><?php echo esc_html(substr($row->created_at, 0, 16)); ?></td>
                                <td><?php echo esc_html($event_label); ?></td>
                                <td><?php echo $row->credits_cost ? esc_html($row->credits_cost) : '—'; ?></td>
                                <td><?php echo $row->credits_after ? esc_html($row->credits_after) : '—'; ?></td>
                                <td><?php echo $row->duration_ms ? esc_html($row->duration_ms . 'ms') : '—'; ?></td>
                                <td style="color:#888"><?php echo esc_html($row->ip_address ?: '—'); ?></td>
                                <td style="color:<?php echo esc_attr($res_color); ?>;font-weight:600"><?php echo esc_html($row->result); ?></td>
                                <td>
                                    <?php if (strlen($notes_full) > 60): ?>
                                        <details>
                                            <summary style="cursor:pointer;color:#2271b1;list-style:none"><?php echo esc_html(mb_substr($notes_full, 0, 60)); ?>…</summary>
                                            <div style="white-space:pre-wrap;margin-top:4px;color:#555;font-size:11px"><?php echo esc_html($notes_full); ?></div>
                                        </details>
                                    <?php else: ?>
                                        <span style="color:#555"><?php echo esc_html($notes_full); ?></span>
                                    <?php endif; ?>
                                </td>
                            </tr>
                        <?php endforeach; ?>
                        </tbody>
                    </table>
                    <?php if ($act_count > 50): ?>
                        <p style="color:#666;margin-top:8px;font-size:12px">
                            Showing most recent 50 of <?php echo esc_html($act_count); ?>.
                            <a href="<?php echo esc_url(admin_url('admin.php?page=pmc-crm-activity&email=' . urlencode($user->email))); ?>">View all in Activity Log &rarr;</a>
                        </p>
                    <?php endif; ?>
                <?php endif; ?>
            </div><!-- /activity -->

            <!-- TAB: Payments -->
            <div id="pmc-tab-payments" class="pmc-tab-panel" style="display:none">
                <?php if (empty($payments)): ?>
                    <p style="color:#666">No payment records yet.</p>
                <?php else: ?>
                    <table class="widefat striped" style="font-size:12px">
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Type</th>
                                <th>Plan</th>
                                <th>Amount</th>
                                <th>Status</th>
                                <th>Billing Period</th>
                                <th>Coupon</th>
                                <th style="width:60px"></th>
                            </tr>
                        </thead>
                        <tbody>
                        <?php foreach ($payments as $idx => $p):
                            $amt_display = strtoupper($p->currency) . ' ' . number_format($p->amount_cents / 100, 2);
                            $period      = ($p->period_start && $p->period_end)
                                ? substr($p->period_start, 0, 10) . ' → ' . substr($p->period_end, 0, 10)
                                : '—';
                            $row_id = 'pmc-pay-row-' . $idx;
                        ?>
                            <tr>
                                <td style="white-space:nowrap"><?php echo esc_html(substr($p->created_at, 0, 10)); ?></td>
                                <td><?php echo esc_html($p->type ?: '—'); ?></td>
                                <td><?php echo esc_html($p->plan ?: '—'); ?></td>
                                <td style="font-weight:600"><?php echo esc_html($amt_display); ?></td>
                                <td><?php echo esc_html($p->status ?: '—'); ?></td>
                                <td style="color:#555"><?php echo esc_html($period); ?></td>
                                <td><?php echo esc_html($p->coupon_code ?: '—'); ?></td>
                                <td>
                                    <button type="button" class="button button-small pmc-pay-toggle" data-row="<?php echo esc_attr($row_id); ?>">IDs ▾</button>
                                </td>
                            </tr>
                            <tr id="<?php echo esc_attr($row_id); ?>" style="display:none;background:#fafafa">
                                <td colspan="8" style="padding:8px 12px">
                                    <div style="display:flex;flex-wrap:wrap;gap:12px;font-size:11px;color:#555">
                                        <?php if ($p->stripe_payment_intent): ?>
                                        <span><strong>PI:</strong> <code><?php echo esc_html($p->stripe_payment_intent); ?></code></span>
                                        <?php endif; ?>
                                        <?php if ($p->stripe_invoice_id): ?>
                                        <span><strong>Invoice:</strong> <code><?php echo esc_html($p->stripe_invoice_id); ?></code></span>
                                        <?php endif; ?>
                                        <?php if ($p->stripe_subscription_id): ?>
                                        <span><strong>Sub:</strong> <code><?php echo esc_html($p->stripe_subscription_id); ?></code></span>
                                        <?php endif; ?>
                                        <?php if ($p->stripe_customer_id): ?>
                                        <span><strong>Customer:</strong> <code><?php echo esc_html($p->stripe_customer_id); ?></code></span>
                                        <?php endif; ?>
                                        <?php if ($p->stripe_price_id): ?>
                                        <span><strong>Price:</strong> <code><?php echo esc_html($p->stripe_price_id); ?></code></span>
                                        <?php endif; ?>
                                        <?php if ($p->stripe_charge_id): ?>
                                        <span><strong>Charge:</strong> <code><?php echo esc_html($p->stripe_charge_id); ?></code></span>
                                        <?php endif; ?>
                                        <?php if ($p->billing_reason): ?>
                                        <span><strong>Billing reason:</strong> <?php echo esc_html($p->billing_reason); ?></span>
                                        <?php endif; ?>
                                    </div>
                                </td>
                            </tr>
                        <?php endforeach; ?>
                        </tbody>
                    </table>
                <?php endif; ?>
            </div><!-- /payments -->

            <!-- TAB: Send Email -->
            <div id="pmc-tab-email" class="pmc-tab-panel" style="display:none">
                <div style="background:#fff;border:1px solid #ddd;border-radius:6px;padding:20px;max-width:560px">
                    <h2 style="margin-top:0;font-size:14px;font-weight:600">Send Email to <?php echo esc_html($user->email); ?></h2>
                    <form method="post">
                        <?php wp_nonce_field('pc_send_email_' . $user_id, 'pc_send_email_nonce'); ?>
                        <p>
                            <label style="font-size:13px">Template<br>
                                <select name="pc_email_template" id="pmc-email-tpl" style="margin-top:4px;width:100%"
                                    onchange="document.getElementById('pmc-custom-fields').style.display = this.value==='custom' ? 'block' : 'none'">
                                    <?php foreach ($tpl_rows as $t): ?>
                                        <option value="<?php echo esc_attr($t->slug); ?>"><?php echo esc_html($t->label . ' (' . $t->slug . ')'); ?></option>
                                    <?php endforeach; ?>
                                    <option value="custom">— Custom —</option>
                                </select>
                            </label>
                        </p>
                        <div id="pmc-custom-fields" style="display:none">
                            <p><label style="font-size:13px">Subject<br><input type="text" name="pc_custom_subject" class="regular-text" value="PMC Notification" style="margin-top:4px"></label></p>
                            <p><label style="font-size:13px">Body (HTML)<br><textarea name="pc_custom_body" rows="7" class="large-text" style="margin-top:4px"></textarea></label></p>
                        </div>
                        <?php submit_button('Send Email', 'primary', '', false); ?>
                    </form>
                </div>
            </div><!-- /email -->

        </div><!-- .pmc-tabs -->

        <script>
        (function() {
            var tabs   = document.querySelectorAll('.pmc-tab-btn');
            var panels = document.querySelectorAll('.pmc-tab-panel');

            function showTab(id) {
                tabs.forEach(function(t) {
                    var active = t.dataset.tab === id;
                    t.style.borderBottomColor = active ? '#2271b1' : 'transparent';
                    t.style.color             = active ? '#2271b1' : '#1d2327';
                    t.style.fontWeight        = active ? '600' : '400';
                    t.style.background        = active ? '#f6f7f7' : 'none';
                });
                panels.forEach(function(p) {
                    p.style.display = p.id === 'pmc-tab-' + id ? '' : 'none';
                });
                if (history.replaceState) {
                    history.replaceState(null, '', location.pathname + location.search + '#tab-' + id);
                }
            }

            tabs.forEach(function(t) {
                t.addEventListener('click', function() { showTab(t.dataset.tab); });
            });

            // Initial tab: server-set default or URL hash
            var wrap    = document.querySelector('.pmc-tabs');
            var initial = (wrap && wrap.dataset.initial) ? wrap.dataset.initial : 'overview';
            var hash    = location.hash.replace('#tab-', '');
            var valid   = ['overview','edit','activity','payments','email'];
            showTab(valid.indexOf(hash) !== -1 ? hash : initial);

            // API key toggle
            var showKey = document.getElementById('pmc-show-key');
            if (showKey) {
                showKey.addEventListener('change', function() {
                    document.getElementById('pmc-key-masked').style.display = this.checked ? 'none' : '';
                    document.getElementById('pmc-key-full').style.display   = this.checked ? '' : 'none';
                });
            }

            // Payment Stripe ID toggles
            document.querySelectorAll('.pmc-pay-toggle').forEach(function(btn) {
                btn.addEventListener('click', function() {
                    var row  = document.getElementById(this.dataset.row);
                    var open = row.style.display !== 'none';
                    row.style.display  = open ? 'none' : '';
                    this.textContent   = open ? 'IDs ▾' : 'IDs ▴';
                });
            });
        })();
        </script>
    </div>
    <?php
}
