<?php
/**
 * Script und Stylesheet des Widgets: einmal registriert, nur auf Seiten mit dem Widget geladen.
 * Das Script lädt im <head> (ohne defer), auf der Verwaltungsseite zusätzlich vor allen anderen
 * Scripts, damit es das Token aus dem Link entfernt, bevor andere Scripts die Adresse lesen.
 *
 * @package FwBooking
 */

defined( 'ABSPATH' ) || exit;

const FW_BOOKING_SCRIPT = 'fw-booking-widget';
const FW_BOOKING_STYLE  = 'fw-booking-widget';

/**
 * Version für Cache-Busting: Änderungszeit der kopierten Datei, sonst Plugin-Version.
 *
 * @param string $file Dateiname in assets/.
 */
function fw_booking_asset_version( string $file ): string {
	$path = FW_BOOKING_DIR . 'assets/' . $file;
	return file_exists( $path ) ? FW_BOOKING_VERSION . '-' . filemtime( $path ) : FW_BOOKING_VERSION;
}

/**
 * Registriert Script und Stylesheet (auf init).
 */
function fw_booking_register_assets(): void {
	wp_register_script(
		FW_BOOKING_SCRIPT,
		FW_BOOKING_URL . 'assets/fw-booking-widget.js',
		array(),
		fw_booking_asset_version( 'fw-booking-widget.js' ),
		array( 'in_footer' => false )
	);
	wp_register_style(
		FW_BOOKING_STYLE,
		FW_BOOKING_URL . 'assets/fw-booking-widget.css',
		array(),
		fw_booking_asset_version( 'fw-booking-widget.css' )
	);
}

/**
 * Bindet beide Dateien ein; mehrfache Aufrufe sind folgenlos (WordPress lädt jede Datei einmal).
 */
function fw_booking_enqueue_assets(): void {
	wp_enqueue_script( FW_BOOKING_SCRIPT );
	wp_enqueue_style( FW_BOOKING_STYLE );
}

/**
 * Ob die aktuelle Seite die Verwaltungsseite ist.
 */
function fw_booking_is_manage_page(): bool {
	$page_id = fw_booking_settings()['manage_page_id'];
	return $page_id > 0 && is_page( $page_id );
}

/**
 * Ob der Inhalt der aktuellen Seite den Shortcode oder Block enthält.
 */
function fw_booking_content_has_widget(): bool {
	if ( ! is_singular() ) {
		return false;
	}
	$post = get_post();
	if ( ! $post instanceof WP_Post ) {
		return false;
	}
	return has_shortcode( $post->post_content, 'fw_booking' ) || has_block( 'fw-booking/calendar', $post );
}

// Seiten mit Widget im Inhalt: Dateien schon im <head> einbinden. Andere Stellen (z. B.
// Widget-Bereiche) binden sie beim Rendern ein; WordPress gibt sie dann im Footer aus.
add_action(
	'wp_enqueue_scripts',
	static function (): void {
		if ( fw_booking_is_ready() && ( fw_booking_is_manage_page() || fw_booking_content_has_widget() ) ) {
			fw_booking_enqueue_assets();
		}
	}
);

// Verwaltungsseite: Script als Erstes im <head> ausgeben, vor Analytics und anderen Scripts.
add_action(
	'wp_head',
	static function (): void {
		if ( fw_booking_is_ready() && fw_booking_is_manage_page() ) {
			wp_print_scripts( FW_BOOKING_SCRIPT );
		}
	},
	1
);
