<?php
defined('ABSPATH') || exit;

function pc_page_promos(): void {
    if (!current_user_can('manage_options')) return;

    global $wpdb;
    $table  = $wpdb->prefix . 'pc_promo_codes';
    $notice = '';

    // Create promo
    if (isset($_POST['pc_create_promo_nonce'])) {
        if (wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['pc_create_promo_nonce'])), 'pc_create_promo')) {
            $code = strtoupper(sanitize_text_field($_POST['promo_code'] ?? ''));
            if (empty($code)) $code = strtoupper(bin2hex(random_bytes(4)));
            $db_result = $wpdb->insert($table, [
                'code'          => $code,
                'credits_grant' => (int) ($_POST['credits_grant']   ?? 0),
                'plan_override' => sanitize_text_field($_POST['plan_override']  ?? ''),
                'days_override' => (int) ($_POST['days_override']   ?? 0),
                'max_uses'      => strlen($_POST['max_uses'] ?? '') > 0 ? (int) $_POST['max_uses'] : null,
                'expires_at'    => !empty($_POST['expires_at']) ? sanitize_text_field($_POST['expires_at']) : null,
                'is_active'     => 1,
                'notes'         => sanitize_textarea_field($_POST['promo_notes'] ?? ''),
            ]);
            if (false === $db_result) {
                error_log('pc_create_promo: DB insert failed for code=' . $code);
            }
            $notice = 'Promo code created: ' . $code;
        }
    }

    // Toggle active
    if (isset($_POST['pc_toggle_nonce'], $_POST['promo_id'])) {
        $pid = (int) $_POST['promo_id'];
        if (wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['pc_toggle_nonce'])), 'pc_toggle_promo_' . $pid)) {
            $current    = (int) $wpdb->get_var($wpdb->prepare("SELECT is_active FROM `{$table}` WHERE id=%d", $pid));
            $db_result  = $wpdb->update($table, ['is_active' => $current ? 0 : 1], ['id' => $pid]);
            if (false === $db_result) {
                error_log('pc_toggle_promo: DB update failed for id=' . $pid);
            }
            $notice = 'Promo code ' . ($current ? 'deactivated' : 'activated') . '.';
        }
    }

    // Delete
    if (isset($_POST['pc_delete_nonce'], $_POST['promo_id'])) {
        $pid = (int) $_POST['promo_id'];
        if (wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['pc_delete_nonce'])), 'pc_delete_promo_' . $pid)) {
            $db_result = $wpdb->delete($table, ['id' => $pid]);
            if (false === $db_result) {
                error_log('pc_delete_promo: DB delete failed for id=' . $pid);
            }
            $notice = 'Promo code deleted.';
        }
    }

    $promos = $wpdb->get_results("SELECT * FROM `{$table}` ORDER BY created_at DESC") ?: [];
    $plans  = pc_get_plans();
    ?>
    <div class="wrap">
        <h1>Promo Codes</h1>
        <?php if ($notice): ?>
            <div class="notice notice-success is-dismissible"><p><?php echo esc_html($notice); ?></p></div>
        <?php endif; ?>

        <!-- Create form -->
        <div style="background:#fff;border:1px solid #ddd;border-radius:6px;padding:16px;margin-bottom:20px">
            <h2 style="margin-top:0;font-size:15px">Create Promo Code</h2>
            <form method="post">
                <?php wp_nonce_field('pc_create_promo', 'pc_create_promo_nonce'); ?>
                <table class="form-table" role="presentation">
                    <tr>
                        <th><label for="promo_code">Code</label></th>
                        <td>
                            <input type="text" id="promo_code" name="promo_code" placeholder="Leave blank to auto-generate" style="width:180px;text-transform:uppercase">
                            <?php echo pc_tip('Leave blank to auto-generate a random 8-character code'); ?>
                        </td>
                    </tr>
                    <tr>
                        <th><label>Credits to Grant</label></th>
                        <td><input type="number" name="credits_grant" value="0" min="0" class="small-text"></td>
                    </tr>
                    <tr>
                        <th><label>Plan Override</label></th>
                        <td>
                            <select name="plan_override">
                                <option value="">— None —</option>
                                <?php foreach ($plans as $p): ?>
                                    <option value="<?php echo esc_attr($p['slug']); ?>"><?php echo esc_html($p['label']); ?></option>
                                <?php endforeach; ?>
                            </select>
                            <?php echo pc_tip('Override the plan assigned when this code is used'); ?>
                        </td>
                    </tr>
                    <tr>
                        <th><label>Days Override</label></th>
                        <td><input type="number" name="days_override" value="0" min="0" class="small-text">
                        <?php echo pc_tip('Override trial/subscription duration. 0 = no override'); ?></td>
                    </tr>
                    <tr>
                        <th><label>Max Uses</label></th>
                        <td><input type="number" name="max_uses" value="" min="1" class="small-text" placeholder="Unlimited">
                        <?php echo pc_tip('Leave blank for unlimited uses'); ?></td>
                    </tr>
                    <tr>
                        <th><label>Expires At</label></th>
                        <td><input type="date" name="expires_at"></td>
                    </tr>
                    <tr>
                        <th><label>Notes</label></th>
                        <td><textarea name="promo_notes" rows="2" cols="40"></textarea></td>
                    </tr>
                </table>
                <?php submit_button('Create Promo Code', 'primary', '', false); ?>
            </form>
        </div>

        <!-- List table -->
        <table class="widefat striped">
            <thead>
                <tr>
                    <th>Code</th><th>Credits Grant</th><th>Plan Override</th><th>Days Override</th>
                    <th>Uses / Max</th><th>Expires</th><th>Active</th><th>Actions</th>
                </tr>
            </thead>
            <tbody>
            <?php foreach ($promos as $promo): ?>
                <tr>
                    <td><strong><?php echo esc_html($promo->code); ?></strong></td>
                    <td><?php echo esc_html($promo->credits_grant ?: '—'); ?></td>
                    <td><?php echo esc_html($promo->plan_override ?: '—'); ?></td>
                    <td><?php echo esc_html($promo->days_override ?: '—'); ?></td>
                    <td><?php echo esc_html($promo->uses_count . ' / ' . ($promo->max_uses ?? '∞')); ?></td>
                    <td><?php echo esc_html($promo->expires_at ?: 'Never'); ?></td>
                    <td style="color:<?php echo (int)$promo->is_active ? '#0a6b0a' : '#b32d2e'; ?>;font-weight:bold">
                        <?php echo (int)$promo->is_active ? 'Yes' : 'No'; ?>
                    </td>
                    <td>
                        <form method="post" style="display:inline">
                            <?php wp_nonce_field('pc_toggle_promo_' . $promo->id, 'pc_toggle_nonce'); ?>
                            <input type="hidden" name="promo_id" value="<?php echo esc_attr($promo->id); ?>">
                            <button type="submit" class="button button-small"><?php echo (int)$promo->is_active ? 'Deactivate' : 'Activate'; ?></button>
                        </form>
                        <form method="post" style="display:inline">
                            <?php wp_nonce_field('pc_delete_promo_' . $promo->id, 'pc_delete_nonce'); ?>
                            <input type="hidden" name="promo_id" value="<?php echo esc_attr($promo->id); ?>">
                            <button type="submit" class="button button-small" onclick="return confirm('Delete this promo code?')">Delete</button>
                        </form>
                    </td>
                </tr>
                <!-- Usage log (last 10 from activity) -->
                <?php
                global $wpdb;
                $uses = $wpdb->get_results($wpdb->prepare(
                    "SELECT created_at, email, result FROM `{$wpdb->prefix}pc_activity`
                     WHERE action='trial_request' AND notes LIKE %s ORDER BY created_at DESC LIMIT 10",
                    '%promo=' . $wpdb->esc_like($promo->code) . '%'
                )) ?: [];
                if (!empty($uses)):
                ?>
                <tr>
                    <td colspan="8" style="background:#f9f9f9;padding:8px 12px">
                        <strong>Recent uses:</strong>
                        <?php foreach ($uses as $u): ?>
                            <?php echo esc_html($u->created_at . ' — ' . $u->email . ' [' . $u->result . ']'); ?>;
                        <?php endforeach; ?>
                    </td>
                </tr>
                <?php endif; ?>
            <?php endforeach; ?>
            <?php if (empty($promos)): ?>
                <tr><td colspan="8" style="color:#666;text-align:center">No promo codes yet.</td></tr>
            <?php endif; ?>
            </tbody>
        </table>
    </div>
    <?php
}
