<?php
/**
 * Serverseitige Ausgabe des Blocks; gleiche Funktion wie der Shortcode.
 *
 * @package FwBooking
 *
 * @var array<string, mixed> $attributes Block-Attribute.
 */

defined( 'ABSPATH' ) || exit;

$fw_booking_html = fw_booking_render(
	array( 'service' => isset( $attributes['service'] ) ? (string) $attributes['service'] : '' )
);
if ( '' !== $fw_booking_html ) {
	printf(
		'<div %1$s>%2$s</div>',
		get_block_wrapper_attributes(), // phpcs:ignore WordPress.Security.EscapeOutput -- von WordPress escaped.
		$fw_booking_html // phpcs:ignore WordPress.Security.EscapeOutput -- in fw_booking_render escaped.
	);
}
