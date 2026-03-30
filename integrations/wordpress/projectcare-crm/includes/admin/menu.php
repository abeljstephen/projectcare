<?php
defined('ABSPATH') || exit;

add_action('admin_menu', function () {
    add_menu_page(
        'ProjectCare CRM',
        'ProjectCare CRM',
        'manage_options',
        'pmc-crm',
        'pc_page_dashboard',
        'dashicons-chart-bar',
        30
    );

    add_submenu_page('pmc-crm', 'Dashboard',       'Dashboard',       'manage_options', 'pmc-crm',          'pc_page_dashboard');
    add_submenu_page('pmc-crm', 'Users',           'Users',           'manage_options', 'pmc-crm-users',    'pc_page_users');
    add_submenu_page('pmc-crm', 'Activity Log',    'Activity Log',    'manage_options', 'pmc-crm-activity', 'pc_page_activity');
    add_submenu_page('pmc-crm', 'Plans',           'Plans',           'manage_options', 'pmc-crm-plans',    'pc_page_plans');
    add_submenu_page('pmc-crm', 'Promo Codes',     'Promo Codes',     'manage_options', 'pmc-crm-promos',   'pc_page_promos');
    add_submenu_page('pmc-crm', 'Email Templates', 'Email Templates', 'manage_options', 'pmc-crm-emails',   'pc_page_emails');
    add_submenu_page('pmc-crm', 'Stripe Log',      'Stripe Log',      'manage_options', 'pmc-crm-stripe',   'pc_page_stripe_log');
    add_submenu_page('pmc-crm', 'GAS Status',      'GAS Status',      'manage_options', 'pmc-crm-gas',      'pc_page_gas');
    add_submenu_page('pmc-crm', 'Settings',        'Settings',        'manage_options', 'pmc-crm-settings', 'pc_page_settings');
    add_submenu_page('pmc-crm', 'Tools',           'Tools',           'manage_options', 'pmc-crm-tools',    'pc_page_tools');
    add_submenu_page('pmc-crm', 'Help',            'Help',            'manage_options', 'pmc-crm-help',     'pc_page_help');
});

add_action('admin_enqueue_scripts', function (string $hook) {
    if ($hook === 'pmc-crm_page_pmc-crm-gas') {
        wp_enqueue_script(
            'chartjs',
            'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
            [],
            '4.4.0',
            true
        );
    }
});
