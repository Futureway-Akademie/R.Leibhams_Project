# Buchungs-Widget (`@fw-booking/widget`)

Öffentliches Widget für Kurse und Einzeltermine. Es läuft im Light DOM der einbindenden Seite (kein iframe, kein Shadow DOM), erzeugt alle Inhalte sicher per DOM und verwendet ausschließlich Klassen mit dem Präfix `fw-booking-`.

## Build

```bash
pnpm --filter @fw-booking/widget build
```

Ergebnis in `dist/`:

| Datei                   | Inhalt                                                      |
| ----------------------- | ----------------------------------------------------------- |
| `fw-booking-widget.js`  | Script (IIFE, ES2020, ohne Abhängigkeiten), höchstens 50 KB |
| `fw-booking-widget.css` | Basisstyles, alle unter `.fw-booking-root`, höchstens 20 KB |

Lokale Prüfseite: `pnpm --filter @fw-booking/widget demo` (http://localhost:5180/demo/, Parameter siehe `demo/index.html`, u. a. `&theme=dark`).

## Einbindung

```html
<link rel="stylesheet" href="https://…/fw-booking-widget.css" />

<div
  data-fw-booking-calendar="cal_…"
  data-fw-booking-api="https://buchung.example.de"
  data-fw-booking-privacy-url="https://kunde.example.de/datenschutz"
></div>

<script src="https://…/fw-booking-widget.js" defer></script>
```

| Attribut                      | Pflicht | Bedeutung                                                              |
| ----------------------------- | ------- | ---------------------------------------------------------------------- |
| `data-fw-booking-calendar`    | ja      | Öffentliche Kalenderkennung der Installation (`cal_…`)                 |
| `data-fw-booking-api`         | ja      | Basisadresse der Buchungs-API (http(s), ohne Query und Fragment)       |
| `data-fw-booking-privacy-url` | ja      | Datenschutzhinweise der Website (http(s), auch relativ, Query erlaubt) |
| `data-fw-booking-service`     | nein    | Angebots-ID; ohne Angabe zeigt das Widget alle Angebote zur Auswahl    |

Mehrere Container pro Seite sind möglich, das Script darf mehrfach eingebunden sein. Der Origin der Seite muss in der API unter `CORS_ALLOWED_ORIGINS` freigegeben sein.

### JavaScript-Schnittstelle

`window.FwBooking` (einmalig installiert, eingefroren):

| Aufruf                         | Wirkung                                                            |
| ------------------------------ | ------------------------------------------------------------------ |
| `FwBooking.scan(element?)`     | Initialisiert alle noch nicht initialisierten Container im Bereich |
| `FwBooking.mount(container)`   | Initialisiert einen Container (liefert eine bestehende Instanz)    |
| `FwBooking.unmount(container)` | Entfernt die Instanz und bricht laufende Anfragen ab               |
| `FwBooking.version`            | Version des Widgets                                                |

### Ereignisse

Beide Ereignisse werden am Container ausgelöst und bubbeln; sie enthalten keine personenbezogenen Daten.

| Ereignis            | `detail`                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| `fw-booking:select` | Gewählter Termin `{ type, calendarId, serviceId, sessionId?, startsAt, endsAt, timeZone }` oder `null` |
| `fw-booking:booked` | `{ calendarId, bookingId, type, serviceId, serviceTitle, startsAt, endsAt, timeZone }`                 |

## Styling-Schnittstelle

### Grundsätze

- Alle Regeln beginnen mit `.fw-booking-root`; außerhalb des Widgets wirkt nichts.
- Ein gezielter Reset setzt Buttons, Eingabefelder, Listen, Tabellen und Überschriften innerhalb des Widgets zurück (Ränder, Abstände, Hintergründe, Schriftvererbung). Er nutzt `:where()`, damit eigene Regeln mit einer einzigen Klasse (`.fw-booking-root .fw-booking-…`) zuverlässig gewinnen.
- Schriftfamilie, Schriftgröße, Zeilenhöhe und Textfarbe erben vom Theme, bis die zugehörigen Properties gesetzt werden.
- Einzige `!important`-Regel: `.fw-booking-root [hidden] { display: none }`, damit Themes ausgeblendete Elemente nicht wieder einblenden.
- Kein automatischer Dunkelmodus. Dunkle Seiten setzen die Farben selbst (Beispiel unten).

### Custom Properties

Gesetzt werden sie auf `.fw-booking-root` oder einem umgebenden Element mit höherer Spezifität (z. B. `.mein-theme .fw-booking-root`).

| Property                             | Standard                  | Verwendung                                       |
| ------------------------------------ | ------------------------- | ------------------------------------------------ |
| `--fw-booking-font-family`           | erbt vom Theme            | Schriftfamilie                                   |
| `--fw-booking-font-size`             | erbt vom Theme            | Grundschriftgröße (alle Maße skalieren in `em`)  |
| `--fw-booking-line-height`           | erbt vom Theme            | Zeilenhöhe                                       |
| `--fw-booking-color-text`            | `currentColor`            | Textfarbe (Standard: Textfarbe des Themes)       |
| `--fw-booking-color-muted`           | `rgb(110 110 110)`        | Nebentexte, Wochentage, Hinweise                 |
| `--fw-booking-color-accent`          | `#1d4ed8`                 | Auswahl, primäre Schaltflächen, Links            |
| `--fw-booking-color-accent-text`     | `#ffffff`                 | Text auf der Akzentfarbe                         |
| `--fw-booking-color-surface`         | `transparent`             | Hintergrund von Schaltflächen und Eingabefeldern |
| `--fw-booking-color-surface-hover`   | `rgb(127 127 127 / 0.12)` | Hover-Hintergrund                                |
| `--fw-booking-color-surface-muted`   | `rgb(127 127 127 / 0.08)` | Freie Tage, Leisten, Meldungen                   |
| `--fw-booking-color-border`          | `rgb(127 127 127 / 0.45)` | Rahmen                                           |
| `--fw-booking-color-error`           | `#b91c1c`                 | Fehlertexte und -rahmen                          |
| `--fw-booking-color-error-surface`   | `rgb(185 28 28 / 0.08)`   | Hintergrund von Fehlermeldungen                  |
| `--fw-booking-color-warning`         | `#92400e`                 | Rahmen von Hinweisen (z. B. Termin vergeben)     |
| `--fw-booking-color-warning-surface` | `rgb(217 119 6 / 0.12)`   | Hintergrund von Hinweisen                        |
| `--fw-booking-color-success`         | `#15803d`                 | Bestätigung                                      |
| `--fw-booking-color-success-surface` | `rgb(21 128 61 / 0.08)`   | Hintergrund der Bestätigung                      |
| `--fw-booking-space-xs`              | `0.25em`                  | Kleinster Abstand                                |
| `--fw-booking-space-sm`              | `0.5em`                   | Kleiner Abstand                                  |
| `--fw-booking-space-md`              | `1em`                     | Standardabstand                                  |
| `--fw-booking-space-lg`              | `1.5em`                   | Großer Abstand                                   |
| `--fw-booking-radius`                | `0.5em`                   | Eckenradius von Karten und Listeneinträgen       |
| `--fw-booking-radius-sm`             | `0.3em`                   | Eckenradius von Schaltflächen und Feldern        |
| `--fw-booking-border-width`          | `1px`                     | Rahmenbreite                                     |
| `--fw-booking-control-height`        | `2.75em`                  | Mindesthöhe von Bedienelementen (≈ 44 px)        |
| `--fw-booking-max-width`             | `42rem`                   | Maximale Breite des Widgets                      |
| `--fw-booking-focus-color`           | Akzentfarbe               | Farbe des Fokusrahmens                           |
| `--fw-booking-focus-width`           | `3px`                     | Breite des Fokusrahmens                          |
| `--fw-booking-focus-offset`          | `2px`                     | Abstand des Fokusrahmens                         |

### Beispiele

```css
/* Markenfarbe und Theme-Schrift */
.fw-booking-root {
  --fw-booking-color-accent: #0f766e;
  --fw-booking-font-family: 'Source Sans 3', sans-serif;
}

/* Dunkle Seite */
.dark-theme .fw-booking-root {
  --fw-booking-color-text: #f3f4f6;
  --fw-booking-color-muted: #a1a1aa;
  --fw-booking-color-accent: #60a5fa;
  --fw-booking-color-accent-text: #0b1220;
  --fw-booking-color-error: #fca5a5;
  --fw-booking-color-warning: #fcd34d;
  --fw-booking-color-success: #86efac;
}

/* Einzelnes Element anpassen */
.fw-booking-root .fw-booking-submit {
  border-radius: 999px;
}
```

### Klassen und Zustände

Alle Klassen beginnen mit `fw-booking-`. Wichtige Bausteine:

| Bereich       | Klassen                                                                                                                                                                                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rahmen        | `root` (`root--error` bei fehlerhafter Einbindung), `view`, `step`                                                                                                                                                                                             |
| Angebote      | `services`, `service-list`, `service` (`service--single`, `service--group`), `service-name`, `service-meta`, `service-header`, `service-title`, `service-duration`, `service-description`, `back`                                                              |
| Kurse         | `course`, `sessions`, `session-day`, `session-day-title`, `session` (`session--full`), `session-time`, `session-location`, `session-seats`, `more`                                                                                                             |
| Einzeltermine | `single`, `calendar`, `calendar-nav`, `month-prev`, `month-title`, `month-next`, `calendar-grid`, `weekday`, `week`, `day` (`day--free`, `day--unavailable`), `slots`, `slots-title`, `slot-group` (`slot-group--morning`, `--afternoon`, `--evening`), `slot` |
| Weiter        | `continue-bar`, `chosen`, `continue`                                                                                                                                                                                                                           |
| Formular      | `booking`, `change`, `form-title`, `summary`, `form`, `field` (`field--checkbox`), `label`, `input`, `checkbox`, `privacy-link`, `field-hint`, `field-error`, `form-status`, `submit`                                                                          |
| Bestätigung   | `confirmation`, `confirmation-title`, `confirmation-mail`, `book-another`                                                                                                                                                                                      |
| Meldungen     | `status`, `hint`, `message` (`message--info`, `--warning`, `--error`), `retry`, `separator`                                                                                                                                                                    |

Zustände werden über Attribute abgebildet und lassen sich direkt ansprechen:

| Zustand                 | Selektor                                                            |
| ----------------------- | ------------------------------------------------------------------- |
| Gewählt                 | `[aria-pressed='true']` (zusätzlich `--selected`)                   |
| Nicht verfügbarer Tag   | `.fw-booking-day[aria-disabled='true']`                             |
| Heute                   | `.fw-booking-day[aria-current='date']`                              |
| Ausgebuchter Kurstermin | `.fw-booking-session--full` bzw. `:disabled`                        |
| Fehlerhaftes Feld       | `.fw-booking-input[aria-invalid='true']`                            |
| Buchung läuft           | `.fw-booking-form[aria-busy='true']`, `.fw-booking-submit:disabled` |

## Tastatur und Barrierefreiheit

- Alle Bedienelemente sind native Buttons, Eingabefelder und Links; Tab, Umschalt+Tab, Enter und Leertaste funktionieren überall. Keine positiven `tabindex`-Werte.
- Sichtbarer Fokus über `:focus-visible` (Farbe, Breite, Abstand per Custom Properties).
- Monatskalender (WAI-ARIA-Datumsauswahl): ein Tab-Stopp im Raster; Pfeiltasten wechseln den Tag, Pos1/Ende springen zum Wochenanfang/-ende, Bild↑/Bild↓ zum Vor-/Folgemonat (gleicher Tag, begrenzt auf die Monatslänge). Nicht verfügbare Tage bleiben fokussierbar (`aria-disabled`), damit die Navigation den ganzen Monat erreicht; Enter wählt nur verfügbare Tage.
- Uhrzeiten eines Tages: ebenfalls ein Tab-Stopp (zuerst die erste, nach einer Auswahl die gewählte Uhrzeit); Pfeiltasten wechseln über alle Tageszeiten hinweg, Pos1/Ende springen zur ersten/letzten Uhrzeit. So ist „Weiter zu deinen Angaben“ auch bei rund 100 Uhrzeiten mit einem Tab erreichbar.
- Schrittwechsel (Formular, Bestätigung) setzen den Fokus auf die Überschrift; Lade- und Statusmeldungen nutzen `role="status"`, Fehler `role="alert"`.
- Fehler im Formular stehen am Feld (`aria-invalid`, `aria-describedby`), der Fokus springt auf das erste fehlerhafte Feld.
- Bewegungen (Übergänge) nur bei `prefers-reduced-motion: no-preference`.
