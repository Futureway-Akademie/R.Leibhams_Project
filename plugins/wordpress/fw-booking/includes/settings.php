<?php
/**
 * Einstellungen unter „Einstellungen → Buchungskalender“. Gespeichert werden nur öffentliche
 * Werte (API-Adresse, öffentliche Kalenderkennung, Seiten-IDs) – keine Zugangsdaten.
 *
 * @package FwBooking
 */

defined( 'ABSPATH' ) || exit;

const FW_BOOKING_OPTION = 'fw_booking_settings';

/**
 * Gespeicherte Einstellungen mit Standardwerten.
 *
 * @return array{api_url: string, calendar_id: string, privacy_page_id: int, manage_page_id: int}
 */
function fw_booking_settings(): array {
	$stored = get_option( FW_BOOKING_OPTION, array() );
	$stored = is_array( $stored ) ? $stored : array();
	return array(
		'api_url'         => isset( $stored['api_url'] ) ? (string) $stored['api_url'] : '',
		'calendar_id'     => isset( $stored['calendar_id'] ) ? (string) $stored['calendar_id'] : '',
		'privacy_page_id' => isset( $stored['privacy_page_id'] ) ? (int) $stored['privacy_page_id'] : 0,
		'manage_page_id'  => isset( $stored['manage_page_id'] ) ? (int) $stored['manage_page_id'] : 0,
	);
}

/**
 * Ob API-Adresse und Kalenderkennung eingetragen sind.
 */
function fw_booking_is_configured(): bool {
	$settings = fw_booking_settings();
	return '' !== $settings['api_url'] && '' !== $settings['calendar_id'];
}

/**
 * Ob das Widget ausgegeben werden kann (Einstellungen vollständig, Datenschutzseite vorhanden).
 */
function fw_booking_is_ready(): bool {
	return fw_booking_is_configured() && '' !== fw_booking_privacy_url();
}

/**
 * Lokale Installationen dürfen die API über http erreichen, alle anderen nur über https.
 */
function fw_booking_allows_http(): bool {
	return in_array( wp_get_environment_type(), array( 'local', 'development' ), true );
}

/**
 * Bereinigt und prüft die Eingaben der Einstellungsseite.
 *
 * @param mixed $input Rohwerte aus dem Formular.
 * @return array<string, int|string>
 */
function fw_booking_sanitize_settings( $input ): array {
	$input    = is_array( $input ) ? $input : array();
	$previous = fw_booking_settings();
	$clean    = $previous;

	$raw_url = isset( $input['api_url'] ) ? trim( (string) wp_unslash( $input['api_url'] ) ) : '';
	// esc_url_raw leert unzulässige Schemata (z. B. javascript:) – das gilt als Fehler, nicht als
	// bewusst geleertes Feld.
	$api_url = untrailingslashit( esc_url_raw( $raw_url, fw_booking_allows_http() ? array( 'https', 'http' ) : array( 'https' ) ) );
	$parts   = wp_parse_url( $api_url );
	if ( '' === $raw_url ) {
		$clean['api_url'] = '';
	} elseif ( '' === $api_url || ! is_array( $parts ) || empty( $parts['host'] ) || isset( $parts['query'] ) || isset( $parts['fragment'] ) ) {
		add_settings_error( FW_BOOKING_OPTION, 'api_url', __( 'Die API-Adresse ist ungültig (erwartet: https://…, ohne Query und Fragment).', 'fw-booking' ) );
	} else {
		$clean['api_url'] = $api_url;
	}

	$calendar_id = isset( $input['calendar_id'] ) ? trim( sanitize_text_field( wp_unslash( $input['calendar_id'] ) ) ) : '';
	if ( '' === $calendar_id || 1 === preg_match( '/^cal_[A-Za-z0-9_-]{16,}$/', $calendar_id ) ) {
		$clean['calendar_id'] = $calendar_id;
	} else {
		add_settings_error( FW_BOOKING_OPTION, 'calendar_id', __( 'Die Kalenderkennung ist ungültig (erwartet: cal_…).', 'fw-booking' ) );
	}

	foreach ( array( 'privacy_page_id', 'manage_page_id' ) as $key ) {
		$page_id       = isset( $input[ $key ] ) ? absint( $input[ $key ] ) : 0;
		$clean[ $key ] = ( $page_id > 0 && 'page' === get_post_type( $page_id ) ) ? $page_id : 0;
	}

	return $clean;
}

/**
 * Adresse der Datenschutzhinweise: gewählte Seite, sonst die Datenschutzseite von WordPress.
 */
function fw_booking_privacy_url(): string {
	$settings = fw_booking_settings();
	if ( $settings['privacy_page_id'] > 0 && 'publish' === get_post_status( $settings['privacy_page_id'] ) ) {
		return (string) get_permalink( $settings['privacy_page_id'] );
	}
	return get_privacy_policy_url();
}

/**
 * Adresse der Verwaltungsseite (Wert für MANAGE_PAGE_URL der Installation) oder ''.
 */
function fw_booking_manage_url(): string {
	$page_id = fw_booking_settings()['manage_page_id'];
	return $page_id > 0 ? (string) get_permalink( $page_id ) : '';
}

add_action(
	'admin_init',
	static function (): void {
		register_setting(
			'fw_booking',
			FW_BOOKING_OPTION,
			array(
				'type'              => 'array',
				'sanitize_callback' => 'fw_booking_sanitize_settings',
				'default'           => array(),
				'show_in_rest'      => false,
			)
		);
	}
);

add_action(
	'admin_menu',
	static function (): void {
		add_options_page(
			__( 'Buchungskalender', 'fw-booking' ),
			__( 'Buchungskalender', 'fw-booking' ),
			'manage_options',
			'fw-booking',
			'fw_booking_settings_page'
		);
	}
);

/**
 * Auswahlfeld für eine Seite.
 *
 * @param string $key      Schlüssel in den Einstellungen.
 * @param int    $selected Gewählte Seiten-ID.
 * @param string $none     Beschriftung für „keine Auswahl“.
 */
function fw_booking_page_select( string $key, int $selected, string $none ): void {
	wp_dropdown_pages(
		array(
			'name'              => esc_attr( FW_BOOKING_OPTION . '[' . $key . ']' ),
			'id'                => esc_attr( 'fw-booking-' . $key ),
			'selected'          => $selected, // phpcs:ignore WordPress.Security.EscapeOutput -- Zahl.
			'show_option_none'  => esc_html( $none ),
			'option_none_value' => '0',
		)
	);
}

/**
 * Einstellungsseite.
 */
function fw_booking_settings_page(): void {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}
	$settings   = fw_booking_settings();
	$manage_url = fw_booking_manage_url();
	$home       = wp_parse_url( home_url() );
	$origin     = is_array( $home ) && isset( $home['scheme'], $home['host'] )
		? $home['scheme'] . '://' . $home['host'] . ( isset( $home['port'] ) ? ':' . $home['port'] : '' )
		: '';
	?>
	<div class="wrap">
		<h1><?php esc_html_e( 'Buchungskalender', 'fw-booking' ); ?></h1>
		<p><?php esc_html_e( 'Das Widget bucht direkt bei der Buchungs-API. Hier werden nur die öffentliche Adresse und Kennung gespeichert, keine Zugangsdaten.', 'fw-booking' ); ?></p>
		<form method="post" action="options.php">
			<?php settings_fields( 'fw_booking' ); ?>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="fw-booking-api_url"><?php esc_html_e( 'API-Adresse', 'fw-booking' ); ?></label></th>
					<td>
						<input type="url" class="regular-text" id="fw-booking-api_url" name="<?php echo esc_attr( FW_BOOKING_OPTION ); ?>[api_url]" value="<?php echo esc_attr( $settings['api_url'] ); ?>" placeholder="https://buchung.example.de" />
						<p class="description"><?php esc_html_e( 'Basisadresse der Buchungs-API, ohne abschließenden Pfad.', 'fw-booking' ); ?></p>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="fw-booking-calendar_id"><?php esc_html_e( 'Kalenderkennung', 'fw-booking' ); ?></label></th>
					<td>
						<input type="text" class="regular-text code" id="fw-booking-calendar_id" name="<?php echo esc_attr( FW_BOOKING_OPTION ); ?>[calendar_id]" value="<?php echo esc_attr( $settings['calendar_id'] ); ?>" placeholder="cal_…" autocomplete="off" spellcheck="false" />
						<p class="description"><?php esc_html_e( 'Öffentliche Kennung aus dem Verwaltungsportal.', 'fw-booking' ); ?></p>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="fw-booking-privacy_page_id"><?php esc_html_e( 'Datenschutzhinweise', 'fw-booking' ); ?></label></th>
					<td>
						<?php fw_booking_page_select( 'privacy_page_id', $settings['privacy_page_id'], __( '— Datenschutzseite von WordPress verwenden —', 'fw-booking' ) ); ?>
						<p class="description"><?php esc_html_e( 'Wird an der Pflicht-Checkbox im Buchungsformular verlinkt.', 'fw-booking' ); ?></p>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="fw-booking-manage_page_id"><?php esc_html_e( 'Verwaltungsseite', 'fw-booking' ); ?></label></th>
					<td>
						<?php fw_booking_page_select( 'manage_page_id', $settings['manage_page_id'], __( '— keine —', 'fw-booking' ) ); ?>
						<p class="description"><?php esc_html_e( 'Seite mit dem Buchungskalender, auf die der Link in den E-Mails führt. Dort lädt das Widget vor anderen Scripts und zeigt die eigene Buchung.', 'fw-booking' ); ?></p>
					</td>
				</tr>
			</table>
			<?php submit_button(); ?>
		</form>

		<h2><?php esc_html_e( 'Werte für die Installation der Buchungs-API', 'fw-booking' ); ?></h2>
		<table class="form-table" role="presentation">
			<tr>
				<th scope="row"><code>MANAGE_PAGE_URL</code></th>
				<td><code><?php echo esc_html( '' !== $manage_url ? $manage_url : __( '(Verwaltungsseite wählen)', 'fw-booking' ) ); ?></code></td>
			</tr>
			<tr>
				<th scope="row"><code>CORS_ALLOWED_ORIGINS</code></th>
				<td><code><?php echo esc_html( $origin ); ?></code></td>
			</tr>
		</table>
	</div>
	<?php
}
