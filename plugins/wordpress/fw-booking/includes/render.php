<?php
/**
 * Ausgabe des Widget-Containers für Shortcode und Block. Alle Werte werden escaped; ohne
 * vollständige Einstellungen sehen nur Administratoren einen Hinweis.
 *
 * @package FwBooking
 */

defined( 'ABSPATH' ) || exit;

/**
 * Ob auf dieser Seite der Verwaltungs-Container schon vergeben ist (nur der erste wird markiert).
 *
 * @param bool|null $claim true markiert die Vergabe.
 */
function fw_booking_manage_claimed( ?bool $claim = null ): bool {
	static $claimed = false;
	if ( true === $claim ) {
		$claimed = true;
	}
	return $claimed;
}

/**
 * Hinweis für Administratoren bei unvollständiger Einrichtung, für Besucher nichts.
 *
 * @param string $message Hinweistext.
 */
function fw_booking_admin_notice( string $message ): string {
	if ( ! current_user_can( 'manage_options' ) ) {
		return '';
	}
	return sprintf(
		'<p class="fw-booking-setup-notice" role="note"><strong>%1$s</strong> %2$s <a href="%3$s">%4$s</a></p>',
		esc_html__( 'Buchungskalender:', 'fw-booking' ),
		esc_html( $message ),
		esc_url( admin_url( 'options-general.php?page=fw-booking' ) ),
		esc_html__( 'Zu den Einstellungen', 'fw-booking' )
	);
}

/**
 * Container des Widgets.
 *
 * @param array{service?: string} $args Optionen aus Shortcode oder Block.
 */
function fw_booking_render( array $args = array() ): string {
	$settings = fw_booking_settings();
	if ( ! fw_booking_is_configured() ) {
		return fw_booking_admin_notice( __( 'Bitte API-Adresse und Kalenderkennung eintragen.', 'fw-booking' ) );
	}
	$privacy_url = fw_booking_privacy_url();
	if ( '' === $privacy_url ) {
		return fw_booking_admin_notice( __( 'Bitte eine Datenschutzseite festlegen (Einstellungen → Datenschutz oder hier).', 'fw-booking' ) );
	}

	$service = isset( $args['service'] ) ? trim( (string) $args['service'] ) : '';
	if ( '' !== $service && 1 !== preg_match( '/^[0-9a-f]{24}$/', $service ) ) {
		return fw_booking_admin_notice( __( 'Die Angebots-ID ist ungültig (24 Zeichen 0–9 und a–f).', 'fw-booking' ) );
	}

	fw_booking_enqueue_assets();

	$attributes = array(
		'data-fw-booking-calendar'    => $settings['calendar_id'],
		'data-fw-booking-api'         => $settings['api_url'],
		'data-fw-booking-privacy-url' => $privacy_url,
	);
	if ( '' !== $service ) {
		$attributes['data-fw-booking-service'] = $service;
	}
	if ( fw_booking_is_manage_page() && ! fw_booking_manage_claimed() ) {
		fw_booking_manage_claimed( true );
		$attributes['data-fw-booking-manage'] = '';
	}

	$html = '<div class="fw-booking-container"';
	foreach ( $attributes as $name => $value ) {
		$html .= sprintf( ' %s="%s"', $name, 'data-fw-booking-privacy-url' === $name || 'data-fw-booking-api' === $name ? esc_url( $value ) : esc_attr( $value ) );
	}
	$html .= '><noscript>' . esc_html__( 'Bitte aktiviere JavaScript, um einen Termin zu buchen.', 'fw-booking' ) . '</noscript></div>';
	return $html;
}

/**
 * Shortcode [fw_booking service="…"].
 *
 * @param array<string, string>|string $atts Attribute.
 */
function fw_booking_shortcode( $atts ): string {
	$atts = shortcode_atts( array( 'service' => '' ), is_array( $atts ) ? $atts : array(), 'fw_booking' );
	return fw_booking_render( array( 'service' => (string) $atts['service'] ) );
}
