<?php
/**
 * Entfernt beim Löschen des Plugins dessen einzige Option.
 *
 * @package FwBooking
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

delete_option( 'fw_booking_settings' );
