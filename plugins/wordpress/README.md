# WordPress-Plugin „FW Buchungskalender“

Schlankes PHP-Plugin (`plugins/wordpress/fw-booking/`), das das Buchungs-Widget per Shortcode oder Block in WordPress einbindet. Buchungen verarbeitet ausschließlich die Buchungs-API; das Plugin speichert keine Zugangsdaten, sondern nur öffentliche Werte. Kein Node-Paket und nicht Teil des pnpm-Workspaces.

## Aufbau

| Datei                              | Inhalt                                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------- |
| `fw-booking.php`                   | Plugin-Header, Konstanten, Registrierung von Assets, Shortcode und Block (`init`)       |
| `includes/settings.php`            | Option `fw_booking_settings`, Einstellungsseite, Prüfung der Eingaben                   |
| `includes/render.php`              | Ausgabe des Widget-Containers für Shortcode und Block, Hinweise für Administratoren      |
| `includes/assets.php`              | Registrierung und einmaliges Laden von Script und Stylesheet                            |
| `blocks/calendar/`                 | Dynamischer Block `fw-booking/calendar` (`block.json`, Editor-Script ohne Build, `render.php`) |
| `assets/`                          | `fw-booking-widget.js` und `.css`, per `pnpm wp:assets` aus `packages/widget/dist` kopiert (nicht im Repository) |
| `uninstall.php`                    | Entfernt die Option beim Löschen des Plugins                                            |

Alle Funktionen, Konstanten und Optionen tragen das Präfix `fw_booking_` bzw. `FW_BOOKING_`. Voraussetzungen: WordPress ≥ 6.5, PHP ≥ 8.1 (getestet mit WordPress 7.1.3 und PHP 8.4).

## Einrichtung in WordPress

1. `pnpm wp:assets` (baut das Widget und kopiert die Dateien), dann den Ordner `fw-booking` nach `wp-content/plugins/` kopieren und aktivieren.
2. **Einstellungen → Buchungskalender:**
   - **API-Adresse** der Buchungs-API (nur https; http nur bei `WP_ENVIRONMENT_TYPE` `local`/`development`), ohne Query und Fragment.
   - **Kalenderkennung** `cal_…` aus dem Verwaltungsportal.
   - **Datenschutzhinweise:** Standard ist die Datenschutzseite von WordPress (Einstellungen → Datenschutz); ohne veröffentlichte Seite erscheint das Widget nicht.
   - **Verwaltungsseite:** Seite mit dem Buchungskalender, auf die der Link in den E-Mails führt.
3. Die Einstellungsseite zeigt die Werte für die Installation der Buchungs-API: `MANAGE_PAGE_URL` (Permalink der Verwaltungsseite) und `CORS_ALLOWED_ORIGINS` (Origin der WordPress-Seite).

Ungültige Eingaben werden mit einer Meldung abgelehnt; der bisherige Wert bleibt erhalten.

## Einbindung

| Variante  | Beispiel                                               |
| --------- | ------------------------------------------------------ |
| Shortcode | `[fw_booking]` bzw. `[fw_booking service="<Angebots-ID>"]` |
| Block     | „Buchungskalender“ (Kategorie Widgets), Angebots-ID optional in der Seitenleiste |

Beide erzeugen denselben Container mit `data-fw-booking-calendar`, `data-fw-booking-api`, `data-fw-booking-privacy-url` und optional `data-fw-booking-service`; alle Werte werden escaped. Auf der Verwaltungsseite erhält der erste Container zusätzlich `data-fw-booking-manage`. Mehrere Shortcodes oder Blöcke auf einer Seite sind möglich. Fehlen Einstellungen oder ist die Angebots-ID ungültig, sehen Administratoren einen Hinweis mit Link zu den Einstellungen, Besucher nichts.

## Laden der Dateien

- Script und Stylesheet werden einmal registriert (`wp_register_script`/`wp_register_style`, Version aus Plugin-Version und Änderungszeit) und unabhängig von der Zahl der Container genau einmal eingebunden.
- Seiten, deren Inhalt den Shortcode oder Block enthält, laden beide Dateien im `<head>`; das Script ohne `defer`/`async`. Container an anderen Stellen (z. B. Widget-Bereiche) binden die Dateien beim Rendern ein, WordPress gibt sie dann im Footer aus.
- Auf der Verwaltungsseite gibt das Plugin das Script bei `wp_head` mit Priorität 1 aus, also vor Analytics- und anderen Scripts. So entfernt das Widget das Token aus dem Link, bevor andere Scripts die Adresse lesen können.
- Ohne vollständige Einstellungen und Datenschutzseite werden keine Dateien geladen.

## Lokale Testinstanz

Siehe `infra/README.md`, Abschnitt „WordPress“. Kurzfassung:

```bash
pnpm infra:up
pnpm wp:up
```

Danach läuft WordPress unter http://localhost:8080 mit aktivem Plugin (Zugang in `infra/.wordpress-admin`). Für Tests mit der lokalen API diese mit `CORS_ALLOWED_ORIGINS=http://localhost:8080` starten, den Worker mit `MANAGE_PAGE_URL=http://localhost:8080/<verwaltungsseite>/`.

## Prüfung

- `pnpm wp:lint`: `php -l` für alle PHP-Dateien im WordPress-Container (PHP 8.4).
- `pnpm lint`: ESLint für `blocks/calendar/editor.js` und `copy-widget-assets.mjs`.
- Manuell in der lokalen Instanz (Ablauf in der Verifikation von task-4-7 beschrieben).
