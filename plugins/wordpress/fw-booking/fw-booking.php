<?php
/**
 * Plugin Name:       FW Buchungskalender
 * Description:       Bindet das Buchungs-Widget für Kurse und Einzeltermine per Shortcode [fw_booking] oder Block ein. Buchungen verarbeitet ausschließlich die Buchungs-API; das Plugin speichert keine Zugangsdaten.
 * Version:           0.1.0
 * Requires at least: 6.5
 * Requires PHP:      8.1
 * Author:            FutureWay
 * License:           GPL-2.0-or-later
 * Text Domain:       fw-booking
 *
 * @package FwBooking
 */

defined( 'ABSPATH' ) || exit;

define( 'FW_BOOKING_VERSION', '0.1.0' );
define( 'FW_BOOKING_FILE', __FILE__ );
define( 'FW_BOOKING_DIR', plugin_dir_path( __FILE__ ) );
define( 'FW_BOOKING_URL', plugin_dir_url( __FILE__ ) );

require_once FW_BOOKING_DIR . 'includes/settings.php';
require_once FW_BOOKING_DIR . 'includes/render.php';
require_once FW_BOOKING_DIR . 'includes/assets.php';

add_action(
	'init',
	static function (): void {
		fw_booking_register_assets();
		add_shortcode( 'fw_booking', 'fw_booking_shortcode' );
		register_block_type( FW_BOOKING_DIR . 'blocks/calendar' );
	}
);
