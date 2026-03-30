<?php
defined('ABSPATH') || exit;

function pc_page_stripe_log(): void {
    if (!current_user_can('manage_options')) return;

    global $wpdb;
    $table = $wpdb->prefix . 'pc_webhook_log';

    $date_from   = sanitize_text_field($_GET['date_from']   ?? date('Y-m-d', strtotime('-30 days')));
    $date_to     = sanitize_text_field($_GET['date_to']     ?? date('Y-m-d'));
    $event_type  = sanitize_text_field($_GET['event_type']  ?? '');
    $result_f    = sanitize_text_field($_GET['result_f']    ?? '');
    $email_s     = sanitize_text_field($_GET['email']       ?? '');
    $page_num    = max(1, (int) ($_GET['paged'] ?? 1));
    $per_page    = 50;

    // Build WHERE
    $where = ['created_at BETWEEN %s AND %s'];
    $vals  = [$date_from . ' 00:00:00', $date_to . ' 23:59:59'];
    if ($event_type) { $where[] = 'event_type = %s'; $vals[] = $event_type; }
    if ($result_f)   { $where[] = 'result = %s';     $vals[] = $result_f; }
    if ($email_s)    { $where[] = 'email LIKE %s';   $vals[] = '%' . $wpdb->esc_like($email_s) . '%'; }

    $where_sql = implode(' AND ', $where);
    $total     = (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM `{$table}` WHERE {$where_sql}", ...$vals));
    $rows      = $wpdb->get_results($wpdb->prepare(
        "SELECT * FROM `{$table}` WHERE {$where_sql} ORDER BY created_at DESC LIMIT %d OFFSET %d",
        ...array_merge($vals, [$per_page, ($page_num - 1) * $per_page])
    )) ?: [];
    $pages     = max(1, (int) ceil($total / $per_page));

    // Summary counts
    $processed = (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM `{$table}` WHERE {$where_sql} AND result='processed'", ...$vals));
    $skipped   = (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM `{$table}` WHERE {$where_sql} AND result='skipped'",   ...$vals));
    $errors    = (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM `{$table}` WHERE {$where_sql} AND result='error'",     ...$vals));

    $event_types = ['checkout.session.completed','invoice.payment_succeeded','customer.subscription.deleted','unknown'];
    $base_url    = admin_url('admin.php?page=pmc-crm-stripe');
    ?>
    <div class="wrap">
        <h1>Stripe Webhook Log</h1>

        <!-- Filter form -->
        <form method="get" style="margin:12px 0;display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end">
            <input type="hidden" name="page" value="pmc-crm-stripe">
            <div><label>From<br><input type="date" name="date_from" value="<?php echo esc_attr($date_from); ?>"></label></div>
            <div><label>To<br><input type="date" name="date_to" value="<?php echo esc_attr($date_to); ?>"></label></div>
            <div><label>Event Type<br>
                <select name="event_type">
                    <option value="">All Events</option>
                    <?php foreach ($event_types as $et): ?>
                        <option value="<?php echo esc_attr($et); ?>" <?php selected($event_type, $et); ?>><?php echo esc_html($et); ?></option>
                    <?php endforeach; ?>
                </select></label></div>
            <div><label>Result<br>
                <select name="result_f">
                    <option value="">All</option>
                    <option value="processed" <?php selected($result_f, 'processed'); ?>>Processed</option>
                    <option value="skipped"   <?php selected($result_f, 'skipped'); ?>>Skipped</option>
                    <option value="error"     <?php selected($result_f, 'error'); ?>>Error</option>
                </select></label></div>
            <div><label>Email<br><input type="text" name="email" value="<?php echo esc_attr($email_s); ?>" placeholder="Search..."></label></div>
            <?php submit_button('Filter', 'secondary', '', false); ?>
        </form>

        <!-- Summary -->
        <p style="color:#444">
            <strong><?php echo esc_html(number_format($total)); ?></strong> total &mdash;
            <span style="color:#0a6b0a"><strong><?php echo esc_html($processed); ?></strong> processed</span> &mdash;
            <strong><?php echo esc_html($skipped); ?></strong> skipped &mdash;
            <span style="color:<?php echo $errors > 0 ? '#b32d2e' : 'inherit'; ?>"><strong><?php echo esc_html($errors); ?></strong> errors</span>
        </p>

        <table class="widefat striped" style="font-size:12px">
            <thead>
                <tr>
                    <th>Date</th><th>Event Type</th><th>Event ID</th><th>Email</th>
                    <th>Amount</th><th>Result</th><th>Error</th><th>Payload Excerpt</th>
                </tr>
            </thead>
            <tbody>
            <?php foreach ($rows as $row):
                $res_color = $row->result === 'processed' ? '#0a6b0a' : ($row->result === 'error' ? '#b32d2e' : '#666');
                $amount    = $row->amount_cents > 0 ? '$' . number_format($row->amount_cents / 100, 2) : '—';
            ?>
                <tr>
                    <td><?php echo esc_html($row->created_at); ?></td>
                    <td><?php echo esc_html($row->event_type); ?></td>
                    <td style="font-family:monospace;font-size:11px"><?php echo esc_html(substr($row->event_id, 0, 20) . (strlen($row->event_id) > 20 ? '…' : '')); ?></td>
                    <td><?php echo esc_html($row->email ?: '—'); ?></td>
                    <td><?php echo esc_html($amount); ?></td>
                    <td style="color:<?php echo esc_attr($res_color); ?>;font-weight:bold"><?php echo esc_html($row->result); ?></td>
                    <td style="color:#b32d2e;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="<?php echo esc_attr($row->error_message ?? ''); ?>"><?php echo esc_html(mb_substr($row->error_message ?? '', 0, 40)); ?></td>
                    <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:monospace;font-size:10px" title="<?php echo esc_attr($row->payload_excerpt ?? ''); ?>"><?php echo esc_html(mb_substr($row->payload_excerpt ?? '', 0, 80)); ?></td>
                </tr>
            <?php endforeach; ?>
            <?php if (empty($rows)): ?>
                <tr><td colspan="8" style="color:#666;text-align:center">No webhook events found.</td></tr>
            <?php endif; ?>
            </tbody>
        </table>

        <!-- Pagination -->
        <?php if ($pages > 1): ?>
        <div style="margin-top:12px">
            <?php for ($i = 1; $i <= min($pages, 20); $i++):
                $pg_url = add_query_arg(['paged' => $i, 'date_from' => $date_from, 'date_to' => $date_to, 'event_type' => $event_type, 'result_f' => $result_f, 'email' => $email_s], $base_url);
            ?>
                <a href="<?php echo esc_url($pg_url); ?>"
                   class="button <?php echo $i === $page_num ? 'button-primary' : ''; ?>"
                   style="margin-right:2px"><?php echo esc_html($i); ?></a>
            <?php endfor; ?>
        </div>
        <?php endif; ?>
    </div>
    <?php
}
