<?php
/**
 * Plugin Name:  ProjectCare CRM
 * Plugin URI:   https://icarenow.io
 * Description:  Complete API key management, quota tracking, credit system, email automation,
 *               analytics, and GAS monitoring for the ProjectCare GPT. No external CRM required.
 * Version:      2.3.0
 * Author:       iCareNOW
 * Author URI:   https://icarenow.io
 * License:      Proprietary
 */

defined('ABSPATH') || exit;

define('PC_CRM_VERSION', '2.3.0');
define('PC_CRM_DIR',     plugin_dir_path(__FILE__));
define('PC_CRM_URL',     plugin_dir_url(__FILE__));

// Core includes
require_once PC_CRM_DIR . 'includes/schema.php';
require_once PC_CRM_DIR . 'includes/helpers.php';
require_once PC_CRM_DIR . 'includes/plans.php';
require_once PC_CRM_DIR . 'includes/users.php';
require_once PC_CRM_DIR . 'includes/activity.php';
require_once PC_CRM_DIR . 'includes/rate-limiter.php';
require_once PC_CRM_DIR . 'includes/emails.php';
require_once PC_CRM_DIR . 'includes/promo.php';
require_once PC_CRM_DIR . 'includes/stripe.php';
require_once PC_CRM_DIR . 'includes/rest-api.php';
require_once PC_CRM_DIR . 'includes/gas.php';
require_once PC_CRM_DIR . 'includes/fluentcrm.php';

// Admin includes
if (is_admin()) {
    require_once PC_CRM_DIR . 'includes/admin/menu.php';
    require_once PC_CRM_DIR . 'includes/admin/dashboard.php';
    require_once PC_CRM_DIR . 'includes/admin/users-list.php';
    require_once PC_CRM_DIR . 'includes/admin/user-detail.php';
    require_once PC_CRM_DIR . 'includes/admin/activity-log.php';
    require_once PC_CRM_DIR . 'includes/admin/plans-editor.php';
    require_once PC_CRM_DIR . 'includes/admin/promo-codes.php';
    require_once PC_CRM_DIR . 'includes/admin/email-templates.php';
    require_once PC_CRM_DIR . 'includes/admin/stripe-log.php';
    require_once PC_CRM_DIR . 'includes/admin/gas-status.php';
    require_once PC_CRM_DIR . 'includes/admin/settings.php';
    require_once PC_CRM_DIR . 'includes/admin/tools.php';
    require_once PC_CRM_DIR . 'includes/admin/bulk-email.php';
    require_once PC_CRM_DIR . 'includes/admin/help.php';
}

register_activation_hook(__FILE__, 'pc_activate');
function pc_activate(): void {
    pc_migrate_from_pmc();
    pc_create_tables();
    pc_seed_plans();
    pc_seed_email_templates();
    update_option('pc_crm_db_version', PC_CRM_VERSION);
    pc_schedule_crons();
}

// ── PMC → PROJECTCARE MIGRATION ───────────────────────────────────────────────
// Runs once on activation. If wp_pmc_* tables exist from the old plugin,
// renames them to wp_pc_* so all existing data is preserved automatically.
function pc_migrate_from_pmc(): void {
    global $wpdb;

    $tables = [
        'users', 'activity', 'plans', 'promo_codes', 'email_templates',
        'webhook_log', 'api_keys', 'payments', 'plot_data', 'settings_log',
    ];

    foreach ($tables as $t) {
        $old = $wpdb->prefix . 'pmc_' . $t;
        $new = $wpdb->prefix . 'pc_'  . $t;

        $exists_old = $wpdb->get_var("SHOW TABLES LIKE '{$old}'") === $old;
        $exists_new = $wpdb->get_var("SHOW TABLES LIKE '{$new}'") === $new;

        if ($exists_old && !$exists_new) {
            $wpdb->query("RENAME TABLE `{$old}` TO `{$new}`");
            error_log("[ProjectCare CRM] Migrated table {$old} → {$new}");
        }
    }

    // Migrate stored DB version option
    $old_ver = get_option('pmc_crm_db_version');
    if ($old_ver && !get_option('pc_crm_db_version')) {
        update_option('pc_crm_db_version', $old_ver);
        delete_option('pmc_crm_db_version');
    }

    // Migrate all pmc_ settings options to pc_ equivalents
    $settings_keys = [
        'api_secret', 'admin_email', 'wp_url', 'gas_url', 'stripe_secret',
        'stripe_webhook_secret', 'daily_digest', 'fluentcrm_sync',
        'gas_account_type', 'gas_quota_limit',
    ];
    foreach ($settings_keys as $k) {
        $old_val = get_option('pmc_' . $k);
        if ($old_val !== false && get_option('pc_' . $k) === false) {
            update_option('pc_' . $k, $old_val);
            delete_option('pmc_' . $k);
            error_log("[ProjectCare CRM] Migrated option pmc_{$k} → pc_{$k}");
        }
    }
}

register_deactivation_hook(__FILE__, 'pc_deactivate');
function pc_deactivate(): void {
    wp_clear_scheduled_hook('pc_expire_keys_cron');
    wp_clear_scheduled_hook('pc_daily_digest_cron');
    wp_clear_scheduled_hook('pc_auto_rotate_cron');
    wp_clear_scheduled_hook('pc_plot_cleanup_cron');
}

// ── UPGRADE PATH ──────────────────────────────────────────────────────────────
// Runs on every page load — cheap version_compare guard ensures it only does
// real work when the stored DB version is behind the plugin version.
// Handles FTP/SFTP uploads that bypass the activation hook.
add_action('plugins_loaded', 'pc_maybe_upgrade');
function pc_maybe_upgrade(): void {
    $stored = get_option('pc_crm_db_version', '0.0.0');
    if (version_compare($stored, PC_CRM_VERSION, '<')) {
        pc_migrate_from_pmc();
        pc_create_tables();
        pc_seed_plans();
        pc_seed_email_templates();
        update_option('pc_crm_db_version', PC_CRM_VERSION);
        pc_schedule_crons();
    }
}

// ── CRON REGISTRATION ─────────────────────────────────────────────────────────
function pc_schedule_crons(): void {
    if (!wp_next_scheduled('pc_expire_keys_cron')) {
        wp_schedule_event(time(), 'hourly', 'pc_expire_keys_cron');
    }
    if (!wp_next_scheduled('pc_daily_digest_cron')) {
        wp_schedule_event(strtotime('tomorrow midnight'), 'daily', 'pc_daily_digest_cron');
    }
    if (!wp_next_scheduled('pc_auto_rotate_cron')) {
        wp_schedule_event(time(), 'hourly', 'pc_auto_rotate_cron');
    }
    if (!wp_next_scheduled('pc_plot_cleanup_cron')) {
        wp_schedule_event(strtotime('tomorrow midnight'), 'daily', 'pc_plot_cleanup_cron');
    }
}

// ── KEY EXPIRY CRON ───────────────────────────────────────────────────────────
// Runs hourly — marks any key past its expiry date as 'expired'.
// Lazy expiry also happens on validate, but this keeps the DB clean proactively.
add_action('pc_expire_keys_cron', 'pc_run_expire_keys');
function pc_run_expire_keys(): void {
    global $wpdb;
    $table   = $wpdb->prefix . 'pc_users';
    $updated = $wpdb->query($wpdb->prepare(
        "UPDATE `{$table}` SET key_status = 'expired', updated_at = NOW()
         WHERE key_status = 'active'
           AND key_expires IS NOT NULL
           AND key_expires < %s",
        current_time('Y-m-d')
    ));
    if ($updated > 0) {
        error_log('[ProjectCare CRM] Expired ' . $updated . ' key(s) via hourly cron');
    }
}

// ── AUTO-ROTATE KEYS CRON ─────────────────────────────────────────────────────
// Runs hourly — for users with auto_rotate_key=1 expiring today,
// generates a new key, emails it, and resets expiry for 35 more days.
add_action('pc_auto_rotate_cron', 'pc_run_auto_rotate_keys');
function pc_run_auto_rotate_keys(): void {
    global $wpdb;
    $table = $wpdb->prefix . 'pc_users';
    $today = current_time('Y-m-d');

    $candidates = $wpdb->get_results($wpdb->prepare(
        "SELECT * FROM `{$table}` WHERE auto_rotate_key=1 AND key_status='active'
         AND key_expires IS NOT NULL AND key_expires <= %s",
        $today
    )) ?: [];

    foreach ($candidates as $user) {
        $new_key  = bin2hex(random_bytes(32));
        $new_exp  = date('Y-m-d', strtotime('+35 days'));
        pc_revoke_user_keys((int) $user->id, 'superseded', 'auto-rotate on expiry');
        pc_update_user((int) $user->id, [
            'api_key'    => $new_key,
            'key_expires'=> $new_exp,
            'key_status' => 'active',
            'credits_used' => 0,
        ]);
        pc_create_api_key((int) $user->id, $user->email, $new_key, 'auto-rotate on expiry');
        pc_send_email($user->email, 'key_regen', [
            'email'  => $user->email,
            'key'    => $new_key,
            'plan'   => $user->plan,
            'expiry' => $new_exp,
        ]);
        pc_log_activity(['user_id' => (int) $user->id, 'email' => $user->email,
            'action' => 'key_regen', 'result' => 'success',
            'notes'  => 'Auto-rotated key on expiry. New expiry: ' . $new_exp]);
        error_log('[ProjectCare CRM] Auto-rotated key for ' . $user->email);
    }
}

// ── PLOT DATA CLEANUP CRON ────────────────────────────────────────────────────
// Runs daily — deletes plot_data rows older than 7 days (tokens are conversation-scoped).
add_action('pc_plot_cleanup_cron', 'pc_run_plot_cleanup');
function pc_run_plot_cleanup(): void {
    global $wpdb;
    $table   = $wpdb->prefix . 'pc_plot_data';
    $deleted = $wpdb->query(
        "DELETE FROM `{$table}` WHERE created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)"
    );
    if ($deleted > 0) {
        error_log('[ProjectCare CRM] Cleaned up ' . $deleted . ' expired plot_data row(s)');
    }
}

// ── DAILY DIGEST CRON ─────────────────────────────────────────────────────────
// Fires at midnight — sends admin summary of yesterday's activity if enabled.
add_action('pc_daily_digest_cron', 'pc_run_daily_digest');
function pc_run_daily_digest(): void {
    if (pc_setting('daily_digest', '0') !== '1') return;

    $yesterday = date('Y-m-d', strtotime('yesterday'));
    $data      = pc_get_calls_in_window($yesterday, $yesterday);
    $active    = pc_get_user_count('active');
    $total     = pc_get_user_count();

    $subject = 'ProjectCare CRM Daily Digest — ' . date('M j, Y', strtotime('yesterday'));
    $message = "ProjectCare — Daily Summary for " . date('M j, Y', strtotime('yesterday')) . "\n\n"
        . "API Calls:       " . ($data['total_calls']     ?? 0) . "\n"
        . "Credits Used:    " . ($data['credits_consumed'] ?? 0) . "\n"
        . "Unique Users:    " . ($data['unique_users']    ?? 0) . "\n"
        . "Avg Duration:    " . round(($data['avg_duration_ms'] ?? 0) / 1000, 2) . "s\n"
        . "Failed Calls:    " . ($data['failed_calls']    ?? 0) . "\n\n"
        . "Total Users:     " . $total . "\n"
        . "Active Keys:     " . $active . "\n\n"
        . "— ProjectCare CRM v" . PC_CRM_VERSION;

    pc_send_admin_email($subject, $message);
}
