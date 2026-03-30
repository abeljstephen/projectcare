<?php
defined('ABSPATH') || exit;

/**
 * Main Stripe webhook handler — verifies signature then dispatches.
 */
function pc_stripe_webhook(WP_REST_Request $req): WP_REST_Response {
    $payload = $req->get_body();
    $sig     = $req->get_header('stripe-signature') ?? '';

    if (!pc_verify_stripe($payload, $sig, pc_stripe_hook())) {
        pc_log_webhook([
            'source'          => 'stripe',
            'event_type'      => 'unknown',
            'event_id'        => '',
            'email'           => '',
            'amount_cents'    => 0,
            'result'          => 'error',
            'error_message'   => 'Invalid Stripe signature',
            'payload_excerpt' => substr($payload, 0, 200),
        ]);
        return new WP_REST_Response(['error' => 'Invalid Stripe signature'], 400);
    }

    try {
        return pc_stripe_webhook_handle($req, $payload);
    } catch (\Throwable $e) {
        error_log('[ProjectCare CRM] Webhook fatal: ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
        return rest_ensure_response(['received' => true]);
    }
}

/**
 * Inner handler — parses event and routes to sub-handlers.
 */
function pc_stripe_webhook_handle(WP_REST_Request $req, string $payload): WP_REST_Response {
    $event    = json_decode($payload, true);
    $type     = $event['type'] ?? '';
    $event_id = $event['id']   ?? '';

    // Deduplication — reject replayed events within 24 hours
    if ($event_id !== '') {
        $dedup_key = 'pc_stripe_' . md5($event_id);
        if (get_transient($dedup_key) !== false) {
            return rest_ensure_response(['received' => true]);
        }
        set_transient($dedup_key, 1, 24 * HOUR_IN_SECONDS);
    }

    if ($type === 'checkout.session.completed') {
        return _pc_stripe_checkout($event, $event_id, $payload);
    }

    if ($type === 'invoice.payment_succeeded') {
        return _pc_stripe_renewal($event, $event_id, $payload);
    }

    if ($type === 'customer.subscription.deleted') {
        return _pc_stripe_cancel($event, $event_id, $payload);
    }

    pc_log_webhook([
        'source'          => 'stripe',
        'event_type'      => $type,
        'event_id'        => $event_id,
        'email'           => '',
        'amount_cents'    => 0,
        'result'          => 'skipped',
        'payload_excerpt' => substr($payload, 0, 200),
    ]);
    return rest_ensure_response(['received' => true]);
}

/** Handle checkout.session.completed */
function _pc_stripe_checkout(array $event, string $event_id, string $payload): WP_REST_Response {
    $session      = $event['data']['object'];
    $mode         = $session['mode']      ?? 'payment';
    $email        = strtolower($session['customer_details']['email'] ?? '');
    $amount_cents = (int) ($session['amount_total'] ?? 0);
    $amount       = $amount_cents / 100;
    $stripe_id    = $session['customer']       ?? '';
    $sub_id       = $session['subscription']   ?? '';
    $intent       = $session['payment_intent'] ?? 'n/a';

    if (empty($email)) {
        pc_log_webhook(['source' => 'stripe', 'event_type' => 'checkout.session.completed',
            'event_id' => $event_id, 'email' => '', 'amount_cents' => $amount_cents,
            'result' => 'skipped', 'error_message' => 'No email in session', 'payload_excerpt' => substr($payload, 0, 200)]);
        return rest_ensure_response(['received' => true]);
    }

    // Extract coupon from session if present
    $session_coupon = '';
    $discounts = $session['total_details']['breakdown']['discounts'] ?? [];
    if (!empty($discounts[0]['discount']['coupon']['id'])) {
        $session_coupon = $discounts[0]['discount']['coupon']['id'];
    } elseif (!empty($session['discounts'][0]['coupon']['id'])) {
        $session_coupon = $session['discounts'][0]['coupon']['id'];
    }

    // TOP-UP (mode === payment)
    if ($mode === 'payment') {
        $topup_credits = pc_amount_to_topup($amount);
        $user          = pc_get_user_by_email($email);

        if ($user) {
            $old_total = (int) $user->credits_total;
            $used      = (int) $user->credits_used;
            $new_total = $old_total + $topup_credits;
            $remaining = max(0, $new_total - $used);

            pc_update_user((int) $user->id, [
                'credits_total' => $new_total,
            ]);
            pc_log_activity([
                'user_id'        => (int) $user->id,
                'email'          => $email,
                'action'         => 'stripe_topup',
                'operation_type' => 'topup',
                'credits_cost'   => -$topup_credits,
                'credits_before' => $old_total,
                'credits_after'  => $new_total,
                'result'         => 'success',
                'notes'          => '+' . $topup_credits . ' credits via Stripe topup $' . $amount . ' intent=' . $intent,
            ]);
            pc_log_payment([
                'user_id'               => (int) $user->id,
                'email'                 => $email,
                'stripe_payment_intent' => $intent !== 'n/a' ? $intent : '',
                'stripe_customer_id'    => $stripe_id,
                'amount_cents'          => $amount_cents,
                'currency'              => $session['currency'] ?? 'usd',
                'plan'                  => $user->plan,
                'type'                  => 'topup',
                'billing_reason'        => 'one_time',
                'coupon_code'           => $session_coupon,
                'status'                => 'succeeded',
            ]);
            pc_send_email($email, 'subscription_issued', [
                'email'   => $email,
                'plan'    => $user->plan,
                'credits' => $remaining,
                'expiry'  => $user->key_expires,
                'key'     => $user->api_key,
            ]);
            pc_send_admin_email('PMC Top-Up — ' . $topup_credits . ' credits',
                "Email:   {$email}\nCredits: +{$topup_credits}\nAmount:  \${$amount}\nStripe:  {$intent}");
            pc_fluentcrm_sync_user(pc_get_user_by_email($email) ?? $user);
        } else {
            pc_send_admin_email('PMC Top-Up — No Account Found',
                "Top-up payment received but no matching account found.\n\nEmail:  {$email}\nAmount: \${$amount}\nStripe: {$intent}\n\nManually apply or refund.");
        }

        pc_log_webhook(['source' => 'stripe', 'event_type' => 'checkout.session.completed',
            'event_id' => $event_id, 'email' => $email, 'amount_cents' => $amount_cents,
            'result' => $user ? 'processed' : 'error', 'error_message' => $user ? '' : 'no account found',
            'payload_excerpt' => substr($payload, 0, 200)]);
        return rest_ensure_response(['received' => true]);
    }

    // NEW SUBSCRIPTION
    $plan   = pc_amount_to_plan($amount);
    $config = pc_get_plan($plan);
    if (!$config) $config = ['credits' => 20, 'days' => 35];

    $key    = bin2hex(random_bytes(32));
    $expiry = date('Y-m-d', strtotime('+' . (int) $config['days'] . ' days'));

    $existing = pc_get_user_by_email($email);
    if ($existing) {
        // Supersede old key
        pc_update_user((int) $existing->id, [
            'api_key'                => $key,
            'plan'                   => $plan,
            'credits_total'          => (int) $config['credits'],
            'credits_used'           => 0,
            'key_expires'            => $expiry,
            'key_status'             => 'active',
            'stripe_customer_id'     => $stripe_id,
            'stripe_subscription_id' => $sub_id,
        ]);
        $user_id = (int) $existing->id;
        pc_log_activity([
            'user_id' => $user_id, 'email' => $email, 'action' => 'stripe_payment',
            'notes'   => 'Prior key superseded by new ' . $plan . ' subscription',
            'result'  => 'success',
        ]);
    } else {
        $user_id = (int) pc_create_user([
            'email'                  => $email,
            'api_key'                => $key,
            'plan'                   => $plan,
            'credits_total'          => (int) $config['credits'],
            'credits_used'           => 0,
            'key_expires'            => $expiry,
            'key_status'             => 'active',
            'stripe_customer_id'     => $stripe_id,
            'stripe_subscription_id' => $sub_id,
            'source'                 => 'stripe',
            'ip_address'             => pc_get_ip(),
        ]);
    }

    pc_log_activity([
        'user_id'        => $user_id,
        'email'          => $email,
        'action'         => 'stripe_payment',
        'operation_type' => 'subscription',
        'credits_cost'   => 0,
        'credits_before' => 0,
        'credits_after'  => (int) $config['credits'],
        'result'         => 'success',
        'notes'          => 'Subscribed ' . $plan . ' $' . $amount . ' expires=' . $expiry . ' intent=' . $intent,
    ]);
    pc_log_payment([
        'user_id'                => $user_id,
        'email'                  => $email,
        'stripe_payment_intent'  => $intent !== 'n/a' ? $intent : '',
        'stripe_subscription_id' => $sub_id,
        'stripe_customer_id'     => $stripe_id,
        'stripe_invoice_id'      => (string) ($session['invoice'] ?? ''),
        'amount_cents'           => $amount_cents,
        'currency'               => $session['currency'] ?? 'usd',
        'plan'                   => $plan,
        'type'                   => 'subscription',
        'billing_reason'         => 'subscription_create',
        'coupon_code'            => $session_coupon,
        'status'                 => 'succeeded',
    ]);

    pc_send_email($email, 'subscription_issued', [
        'email'   => $email,
        'key'     => $key,
        'plan'    => ucfirst($plan),
        'credits' => (int) $config['credits'],
        'expiry'  => $expiry,
    ]);
    pc_send_admin_email('PMC Subscription — ' . ucfirst($plan),
        "New subscription\n\nEmail:   {$email}\nPlan:    {$plan}\nAmount:  \${$amount}\nCredits: {$config['credits']}\nExpires: {$expiry}\nStripe:  {$intent}");

    $u = pc_get_user_by_id($user_id);
    if ($u) pc_fluentcrm_sync_user($u);

    pc_log_webhook(['source' => 'stripe', 'event_type' => 'checkout.session.completed',
        'event_id' => $event_id, 'email' => $email, 'amount_cents' => $amount_cents,
        'result' => 'processed', 'payload_excerpt' => substr($payload, 0, 200)]);

    return rest_ensure_response(['received' => true]);
}

/** Handle invoice.payment_succeeded (subscription renewal) */
function _pc_stripe_renewal(array $event, string $event_id, string $payload): WP_REST_Response {
    $invoice = $event['data']['object'];
    if (($invoice['billing_reason'] ?? '') !== 'subscription_cycle') {
        return rest_ensure_response(['received' => true]);
    }

    $email        = strtolower($invoice['customer_email'] ?? '');
    $amount_cents = (int) ($invoice['amount_paid'] ?? 0);
    $amount       = $amount_cents / 100;
    $plan         = pc_amount_to_plan($amount);
    $config       = pc_get_plan($plan) ?? ['credits' => 25, 'days' => 35];
    $expiry       = date('Y-m-d', strtotime('+35 days'));

    // Extract Stripe IDs from the invoice object
    $inv_payment_intent = (string) ($invoice['payment_intent'] ?? '');
    $inv_invoice_id     = (string) ($invoice['id']             ?? '');
    $inv_sub_id         = (string) ($invoice['subscription']   ?? '');
    $inv_customer_id    = (string) ($invoice['customer']       ?? '');
    $inv_charge_id      = (string) ($invoice['charge']         ?? '');
    $inv_currency       = strtolower((string) ($invoice['currency'] ?? 'usd'));
    $inv_billing_reason = (string) ($invoice['billing_reason'] ?? 'subscription_cycle');
    $inv_period_start   = isset($invoice['lines']['data'][0]['period']['start']) ? (int) $invoice['lines']['data'][0]['period']['start'] : null;
    $inv_period_end     = isset($invoice['lines']['data'][0]['period']['end'])   ? (int) $invoice['lines']['data'][0]['period']['end']   : null;
    $inv_price_id       = (string) ($invoice['lines']['data'][0]['price']['id']      ?? '');
    $inv_product_id     = (string) ($invoice['lines']['data'][0]['price']['product'] ?? '');
    $inv_coupon         = (string) ($invoice['discount']['coupon']['id']             ?? '');

    $user = pc_get_user_by_email($email);
    if ($user) {
        pc_update_user((int) $user->id, [
            'credits_total' => (int) $config['credits'],
            'credits_used'  => 0,
            'key_expires'   => $expiry,
            'key_status'    => 'active',
        ]);
        pc_log_activity([
            'user_id'        => (int) $user->id,
            'email'          => $email,
            'action'         => 'stripe_renew',
            'operation_type' => 'renewal',
            'credits_before' => (int) $user->credits_total,
            'credits_after'  => (int) $config['credits'],
            'result'         => 'success',
            'notes'          => 'Renewed ' . $plan . ' $' . $amount . ' new_expiry=' . $expiry,
        ]);
        pc_log_payment([
            'user_id'                => (int) $user->id,
            'email'                  => $email,
            'stripe_payment_intent'  => $inv_payment_intent,
            'stripe_invoice_id'      => $inv_invoice_id,
            'stripe_subscription_id' => $inv_sub_id,
            'stripe_customer_id'     => $inv_customer_id,
            'stripe_charge_id'       => $inv_charge_id,
            'stripe_price_id'        => $inv_price_id,
            'stripe_product_id'      => $inv_product_id,
            'amount_cents'           => $amount_cents,
            'currency'               => $inv_currency,
            'plan'                   => $plan,
            'type'                   => 'renewal',
            'billing_reason'         => $inv_billing_reason,
            'period_start'           => $inv_period_start,
            'period_end'             => $inv_period_end,
            'coupon_code'            => $inv_coupon,
            'status'                 => 'succeeded',
        ]);
        delete_transient('pc_warned_' . md5($email));

        pc_send_email($email, 'renewal', [
            'email'   => $email,
            'plan'    => ucfirst($plan),
            'credits' => (int) $config['credits'],
            'expiry'  => $expiry,
        ]);

        $u = pc_get_user_by_id((int) $user->id);
        if ($u) pc_fluentcrm_sync_user($u);
    }

    pc_log_webhook(['source' => 'stripe', 'event_type' => 'invoice.payment_succeeded',
        'event_id' => $event_id, 'email' => $email, 'amount_cents' => $amount_cents,
        'result' => $user ? 'processed' : 'skipped', 'error_message' => $user ? '' : 'no account',
        'payload_excerpt' => substr($payload, 0, 200)]);

    return rest_ensure_response(['received' => true]);
}

/** Handle customer.subscription.deleted (cancellation) */
function _pc_stripe_cancel(array $event, string $event_id, string $payload): WP_REST_Response {
    $email = strtolower($event['data']['object']['customer_email'] ?? '');
    $user  = $email ? pc_get_user_by_email($email) : null;

    if ($user) {
        pc_update_user((int) $user->id, ['key_status' => 'cancelled']);
        pc_log_activity([
            'user_id' => (int) $user->id,
            'email'   => $email,
            'action'  => 'stripe_cancel',
            'result'  => 'success',
            'notes'   => 'Subscription cancelled via Stripe webhook',
        ]);
        pc_fluentcrm_sync_user(pc_get_user_by_id((int) $user->id) ?? $user);
    }

    pc_log_webhook(['source' => 'stripe', 'event_type' => 'customer.subscription.deleted',
        'event_id' => $event_id, 'email' => $email, 'amount_cents' => 0,
        'result' => $user ? 'processed' : 'skipped', 'payload_excerpt' => substr($payload, 0, 200)]);

    return rest_ensure_response(['received' => true]);
}

/**
 * Insert a row into the payments table — full Stripe financial audit trail.
 */
function pc_log_payment(array $data): void {
    global $wpdb;
    $result = $wpdb->insert($wpdb->prefix . 'pc_payments', [
        'user_id'                => isset($data['user_id'])                ? (int)    $data['user_id']                : null,
        'email'                  => (string) ($data['email']               ?? ''),
        'stripe_payment_intent'  => (string) ($data['stripe_payment_intent']  ?? ''),
        'stripe_invoice_id'      => (string) ($data['stripe_invoice_id']       ?? ''),
        'stripe_subscription_id' => (string) ($data['stripe_subscription_id']  ?? ''),
        'stripe_customer_id'     => (string) ($data['stripe_customer_id']      ?? ''),
        'stripe_price_id'        => (string) ($data['stripe_price_id']         ?? ''),
        'stripe_product_id'      => (string) ($data['stripe_product_id']       ?? ''),
        'stripe_charge_id'       => (string) ($data['stripe_charge_id']        ?? ''),
        'amount_cents'           => (int)    ($data['amount_cents']        ?? 0),
        'currency'               => strtolower((string) ($data['currency'] ?? 'usd')),
        'plan'                   => (string) ($data['plan']                ?? ''),
        'type'                   => (string) ($data['type']                ?? ''),
        'billing_reason'         => (string) ($data['billing_reason']      ?? ''),
        'period_start'           => isset($data['period_start']) ? date('Y-m-d H:i:s', (int) $data['period_start']) : null,
        'period_end'             => isset($data['period_end'])   ? date('Y-m-d H:i:s', (int) $data['period_end'])   : null,
        'status'                 => (string) ($data['status']              ?? 'succeeded'),
        'coupon_code'            => (string) ($data['coupon_code']         ?? ''),
        'created_at'             => current_time('mysql'),
    ]);
    if (false === $result) {
        error_log('pc_log_payment: DB insert failed for email=' . ($data['email'] ?? ''));
    }
}

/**
 * Insert a row into the webhook log.
 */
function pc_log_webhook(array $data): void {
    global $wpdb;
    $result = $wpdb->insert($wpdb->prefix . 'pc_webhook_log', [
        'source'          => (string) ($data['source']          ?? 'stripe'),
        'event_type'      => (string) ($data['event_type']      ?? ''),
        'event_id'        => (string) ($data['event_id']        ?? ''),
        'email'           => (string) ($data['email']           ?? ''),
        'amount_cents'    => (int)    ($data['amount_cents']     ?? 0),
        'result'          => (string) ($data['result']          ?? 'processed'),
        'error_message'   => isset($data['error_message']) ? (string) $data['error_message'] : null,
        'payload_excerpt' => isset($data['payload_excerpt']) ? substr((string) $data['payload_excerpt'], 0, 500) : null,
        'created_at'      => current_time('mysql'),
    ]);
    if (false === $result) {
        error_log('pc_log_webhook: DB insert failed for event=' . ($data['event_type'] ?? ''));
    }
}
