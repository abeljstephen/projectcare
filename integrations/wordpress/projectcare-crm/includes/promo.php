<?php
defined('ABSPATH') || exit;

/**
 * Look up a promo code (case-insensitive). Returns the row or null.
 */
function pc_get_promo(string $code): ?object {
    global $wpdb;
    $row = $wpdb->get_row($wpdb->prepare(
        "SELECT * FROM `{$wpdb->prefix}pc_promo_codes` WHERE UPPER(code) = UPPER(%s) LIMIT 1",
        $code
    ));
    return $row ?: null;
}

/**
 * Validate a promo code.
 * Returns [valid: bool, error?: string, promo?: object].
 */
function pc_validate_promo(string $code): array {
    if (empty($code)) return ['valid' => false, 'error' => 'No promo code provided'];

    $promo = pc_get_promo($code);
    if (!$promo) return ['valid' => false, 'error' => 'Invalid promo code'];

    if (!(int) $promo->is_active) {
        return ['valid' => false, 'error' => 'Promo code is no longer active'];
    }
    if ($promo->expires_at !== null && strtotime($promo->expires_at) < time()) {
        return ['valid' => false, 'error' => 'Promo code has expired'];
    }
    if ($promo->max_uses !== null && (int) $promo->uses_count >= (int) $promo->max_uses) {
        return ['valid' => false, 'error' => 'Promo code has reached its usage limit'];
    }

    return ['valid' => true, 'promo' => $promo];
}

/**
 * Increment the uses_count for a promo code by ID.
 */
function pc_use_promo(int $promo_id): void {
    global $wpdb;
    $wpdb->query($wpdb->prepare(
        "UPDATE `{$wpdb->prefix}pc_promo_codes` SET uses_count = uses_count + 1 WHERE id = %d",
        $promo_id
    ));
}
