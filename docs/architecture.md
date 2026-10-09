# Architektur

Eigenständige Buchungsanwendung mit API und MongoDB. WordPress bindet nur das öffentliche Widget ein; Owner arbeiten in einem eigenen Verwaltungsportal, das zugleich als PWA installierbar ist. Je Kunde eine getrennte Installation mit eigener Datenbank, gemeinsamer versionierter Code.

```mermaid
flowchart TD
    V[Interessent] --> WP[WordPress mit Plugin]
    WP --> W[Widget im Light DOM]
    W --> API[Buchungs-API NestJS]
    O[Owner Desktop/Handy] --> P[Portal / PWA]
    P --> API
    API --> DB[(MongoDB Replica Set)]
    API --> OUT[Outbox-Jobs]
    WK[Worker] --> OUT
    WK --> MAIL[E-Mail-Versand]
```

## Repository-Struktur

```
apps/api          Buchungsregeln, Auth, REST
apps/worker       Outbox, Leases, E-Mail
apps/portal       Owner-Portal und PWA
packages/db       Datenmodell, Collections, Migrationen (API und Worker)
packages/shared   Domänentypen, Validierung, Zeitzonen
packages/widget   Öffentliches Widget
plugins/wordpress PHP-Plugin
infra/            docker-compose (MongoDB, Mailpit)
```

## Terminarten

| | Einzeltermin | Gruppenkurs |
|---|---|---|
| Owner pflegt | Öffnungszeiten, Ausnahmen, Dauer (inkl. eventuellem Puffer) | Kurstermine bzw. wiederkehrende Regeln mit Kapazität |
| Interessent sieht | Tag → freie Uhrzeiten | Kurstermine mit freien Plätzen |
| Kapazität | 1 | > 1 |
| Schutz vor Doppelbuchung | Belegungseinheiten der Ressource mit eindeutigem Index | Atomare Kapazitätsprüfung in der Schreibbedingung |

Kurse blockieren die Ressource ebenfalls, sodass Einzeltermine sich nicht mit Kursen überschneiden.

## Collections

`settings`, `owners`, `services`, `openingHours`, `availabilityExceptions`, `courseRules`, `sessions`, `bookings`, `resourceOccupancy`, `actionTokens`, `outboxJobs`, `auditEvents` sowie `_migrations` für angewendete Migrationen.

Dokumenttypen und Collection-Zugriffe: `packages/db/src/documents.ts` (Paket `@fw-booking/db`, von API und Worker genutzt; `apps/api/src/database/documents.ts` re-exportiert es). Zeitpunkte sind BSON-Dates in UTC. Struktur, Validatoren und Indizes entstehen über versionierte Migrationen in `packages/db/src/migrations/` und werden mit `pnpm --filter @fw-booking/api db:migrate` angewendet (nicht beim API- oder Worker-Start).

| Schutz | Umsetzung |
|---|---|
| Keine Doppelbelegung der Ressource | Eindeutiger Index `resourceOccupancy(resourceId, unitStart)`; Validator erzwingt 5-Minuten-Raster |
| Keine Überbuchung eines Kurses | Validator `bookedCount ≤ capacity` auf `sessions` |
| Keine doppelte Buchung bei Wiederholung | Eindeutiger Index `bookings(idempotencyKey)` |
| Eine aktive Buchung je E-Mail und Kurstermin | Eindeutiger Teilindex `bookings(sessionId, participantEmailKey)` für `status: confirmed` |
| Idempotente Kurstermin-Erzeugung | Eindeutiger Teilindex `sessions(ruleId, localStart)` |
| Tokens nur als Hash | Validator verlangt SHA-256-Hex in `actionTokens.tokenHash` |

## Owner-Anmeldung

| Endpunkt | Wirkung |
|---|---|
| `POST /api/auth/login` | Prüft E-Mail und Passwort (Argon2id), legt Sitzung an, setzt Cookie, liefert CSRF-Token |
| `GET /api/auth/session` | Aktuelle Sitzung mit CSRF-Token oder 401 |
| `POST /api/auth/logout` | Löscht Sitzung und Cookie |

- **Standardmäßig gesperrt:** Ein globaler Guard verlangt für jede Route eine Owner-Sitzung; öffentliche Routen werden mit `@Public()` freigegeben.
- **Sitzung:** Zufallstoken (256 Bit) im Cookie `__Host-fw_session` (lokal `fw_session`), `HttpOnly`, `Secure`, `SameSite=Lax`. In `authSessions` liegt nur der SHA-256-Hash. 12 h Inaktivität, maximal 7 Tage; neue Sitzung bei jedem Login.
- **CSRF:** Ändernde Anfragen brauchen `Content-Type: application/json` und den Header `X-CSRF-Token` der Sitzung.
- **Passwort-Raten:** Nach 5 Fehlversuchen in 15 Minuten je E-Mail oder IP antwortet der Login mit 429. Unbekannte E-Mails und falsche Passwörter sind von außen nicht unterscheidbar.
- **Konten:** Keine Selbstregistrierung; Anlage per `owner:create` (Passwort ≥ 12 Zeichen, verdeckte Eingabe).

## Missbrauchsschutz und CORS

`apps/api/src/security/` bündelt den Schutz der öffentlichen API. Die Reihenfolge in `app.factory.ts`: CORS-Prüfung, JSON-Parser, Parserfehler, Cookies, Routen.

- **CORS:** Nur Origins aus `CORS_ALLOWED_ORIGINS` (exakte Origins der WordPress-Seiten, kommagetrennt) erhalten für `/api/public/*` die Header `Access-Control-Allow-Origin`, `Vary: Origin` und bei Preflights `GET, POST`, `Content-Type, X-Booking-Token`, 10 Minuten Cache; keine Credentials. Anfragen mit fremdem `Origin` (auch `null`) beantwortet die API mit 403 `origin_not_allowed`, bevor der Body gelesen wird, sodass sie keine Buchung auslösen. Anfragen ohne `Origin` (Server, curl) sind nicht betroffen. Owner-Routen erhalten keine CORS-Freigabe.
- **Ratenbegrenzung:** `RateLimitGuard` zählt je Client-IP (IPv6 je /64, Client-IP über `TRUST_PROXY`) in festen Fenstern im Speicher der API. Öffentliche Routen fallen standardmäßig unter `read`; `@RateLimit(...)` ordnet zu, `@SkipRateLimit()` nimmt den Healthcheck aus. Owner-Routen sind nicht begrenzt (Login-Schutz siehe oben). Überschreitung: 429 `rate_limited` mit `Retry-After`.

| Grenze | Routen | Standard (Variable) |
|---|---|---|
| `read` | Angebote, Slots, Tage, Kurstermine, Login | 120 je Minute (`RATE_LIMIT_READ`) |
| `booking` | `POST …/bookings` | 10 je 10 Minuten (`RATE_LIMIT_BOOKING`) |
| `manageRead` | Verwaltungslink: Ansicht, mögliche Termine | 60 je Minute (`RATE_LIMIT_MANAGE_READ`) |
| `manageWrite` | Verwaltungslink: Storno, Umbuchung | 10 je 10 Minuten (`RATE_LIMIT_MANAGE_WRITE`) |
| je E-Mail | neue Buchungen derselben Adresse | 5 je Stunde (`BOOKING_LIMIT_PER_EMAIL`) |

  `0` schaltet eine Grenze ab (Tests). Das Limit je E-Mail zählt in `BookingService` die Buchungen der letzten Stunde (Index `participantEmailKey_createdAt`, Migration `007`); Wiederholungen mit gleichem Idempotenzschlüssel und Umbuchungen zählen nicht. Überschreitung: 429 `too_many_bookings`. Bei gleichzeitigen Anfragen derselben Adresse kann es knapp überschritten werden.
- **Eingaben:** Eigener JSON-Parser mit 16 KB Limit; fehlerhaftes JSON ergibt 400 „Ungültige Eingabe“, zu große Anfragen 413, jeweils ohne Parsermeldung. Zod-Fehler nennen nur Feldpfad und Regel, nie Werte. Unbekannte Routen ergeben 404 „Nicht gefunden“ ohne Methode und Pfad.

## Owner-API: Angebote

| Endpunkt | Wirkung |
|---|---|
| `GET /api/owner/services[?active=true\|false]` | Angebote in manueller Reihenfolge |
| `GET /api/owner/services/:id` | Ein Angebot |
| `POST /api/owner/services` | Anlegen (`serviceCreateSchema`), neues Angebot ans Ende |
| `PATCH /api/owner/services/:id` | Teiländerung (`serviceUpdateSchema`), auch Deaktivieren über `active`; Wechsel der Terminart → 409 |
| `PUT /api/owner/services/order` | Reihenfolge aller Angebote (`serviceOrderUpdateSchema`) |

## Owner-API: Öffnungszeiten und Ausnahmen

| Endpunkt | Wirkung |
|---|---|
| `GET /api/owner/opening-hours` | Wochenplan und (nur lesbar) Zeitzone der Installation |
| `PUT /api/owner/opening-hours` | Ersetzt den ganzen Wochenplan (Transaktion) |
| `GET /api/owner/availability-exceptions[?from&to]` | Ausnahmen, die den Zeitraum berühren; Standard ab heute |
| `POST /api/owner/availability-exceptions` | Sperrzeit oder zusätzliche Öffnung; Antwort nennt betroffene bestätigte Buchungen |
| `DELETE /api/owner/availability-exceptions/:id` | Ausnahme entfernen |

`AvailabilityService.openWindowsForDate(datum)` liefert die geöffneten UTC-Fenster eines lokalen Tages: (Wochenplan ∪ zusätzliche Öffnungen) − Sperrzeiten, begrenzt auf den Tag. Darauf baut die Slot-Berechnung auf.

## Slot-Berechnung

`SlotService.slotsForDate(angebot, datum, jetzt)` berechnet freie Einzeltermin-Slots aus den geöffneten Fenstern (`openWindowsForDate`), jeder Startzeit im 5-Minuten-Raster in lokaler Zeit, der Dauer, den belegten 5-Minuten-Einheiten in `resourceOccupancy` (einzige Quelle für Belegungen durch Einzeltermine und Kurse) sowie Mindestvorlauf und Horizont. `availableDates(angebot, von, bis)` nennt Tage mit mindestens einem freien Slot (höchstens 62 Tage).

| Endpunkt | Wirkung |
|---|---|
| `GET /api/owner/services/:id/slots?date=` | Vorschau der freien Slots (Format wie öffentliche API) |
| `GET /api/owner/services/:id/available-dates?from=&to=` | Tage mit freien Slots |

## Owner-API: Kurstermine und Kursregeln

| Endpunkt | Wirkung |
|---|---|
| `GET /api/owner/sessions[?from&to&serviceId&includeCancelled]` | Kurstermine mit Belegung |
| `POST /api/owner/sessions` | Einzelnen Kurstermin anlegen (Belegung der Ressource in derselben Transaktion) |
| `PATCH /api/owner/sessions/:id` | Kapazität (≥ gebuchte Plätze), Ort, Sperren; Uhrzeit nur ohne Buchungen |
| `DELETE /api/owner/sessions/:id` | Nur ohne Buchungshistorie |
| `GET/POST /api/owner/course-rules`, `GET/PATCH/DELETE /api/owner/course-rules/:id` | Kursregeln; Anlegen und Ändern erzeugen Termine und liefern einen Bericht (erzeugt, Konflikte, unverändert gebuchte) |

`CourseRulesService.generateForRule` erzeugt fehlende Termine idempotent über den eindeutigen Index `sessions(ruleId, localStart)`. `localStart` ist bei Regelterminen der Wiederholungsschlüssel und bleibt beim Verschieben erhalten. `CourseGenerationScheduler` ruft die Erzeugung beim Start und alle 6 Stunden auf.

## Owner-API: Buchungen, Teilnehmer und Absagen

Alle Antworten enthalten Teilnehmerdaten und tragen `Cache-Control: no-store`.

| Endpunkt | Wirkung |
|---|---|
| `GET /api/owner/bookings[?from&to&serviceId&sessionId&status]` | Buchungen beider Terminarten; ohne Zeitraum 31 Tage ab heute, höchstens 92 Tage |
| `GET /api/owner/bookings/:id` | Einzelne Buchung |
| `POST /api/owner/bookings/:id/cancel` `{ confirm: true, reason? }` | Einzelne Buchung absagen |
| `GET /api/owner/sessions/:id/participants` | Kurstermin mit allen Buchungen (jeder Status), älteste zuerst |
| `POST /api/owner/sessions/:id/cancel` `{ confirm: true, reason? }` | Kurstermin samt aller bestätigten Buchungen absagen |

`OwnerBookingsService` führt jede Absage in einer Transaktion aus: Status `cancelled_by_owner` (Termin `cancelled`, `bookedCount` 0), Freigabe von Kursplatz, Zeit bzw. Ressourcenbelegung, Entwertung aller Links (`revoked`), je Buchung ein Outbox-Auftrag `owner_cancellation` und Audit (`booking.cancelled_by_owner`, `session.cancelled`, ohne Begründung). Die optionale Begründung steht in `ownerCancellationReason` bzw. `cancellationReason`. Wiederholte Absagen liefern `alreadyCancelled: true`; nicht aktive Buchungen 409 `not_cancellable`, beendete Termine 409 `appointment_ended`.

## Owner-API: Fehlgeschlagene Benachrichtigungen

| Endpunkt | Wirkung |
|---|---|
| `GET /api/owner/notifications/failed[?from&to&type]` | Endgültig fehlgeschlagene, nicht ausgeblendete Jobs, neueste zuerst (höchstens 200, dazu `total`), sowie `retryingCount` (Jobs, die gerade wegen eines vorübergehenden Fehlers wiederholt werden) |
| `POST /api/owner/notifications/failed/:id/retry` | Job erneut einreihen: `pending`, Versuche ab 0, sofort fällig; Audit `notification.retried`. Der Handler prüft den Buchungsstand erneut. |
| `POST /api/owner/notifications/failed/:id/dismiss` | Job ausblenden (`dismissedAt`), bleibt gespeichert und wird nicht mehr erneut versendet; Audit `notification.dismissed` |

Jeder Eintrag enthält `id`, `type`, `category`, `failedAt`, `attempts` und eine Kurzübersicht der Buchung (Angebot, Beginn, Status, Name, E-Mail, Telefon) oder `null`, wenn sie nicht mehr existiert. Antworten tragen `Cache-Control: no-store` und werden gegen strikte Schemas aus `@fw-booking/shared` geprüft (`failedNotificationsResponseSchema`); interne Felder wie `leaseToken` oder `dedupeKey` verhindern die Auslieferung. Kategorien sind eine feste Aufzählung (`notificationErrorCategorySchema`), unbekannte Werte erscheinen als `unknown`. Deutsche Beschreibungen und der Hinweis, ob ein erneuter Versuch sinnvoll ist, stehen in `NOTIFICATION_ERROR_INFO`, Typbezeichnungen in `NOTIFICATION_TYPE_LABELS`. Index `status_failedAt` (Migration `009`).

## Öffentliches Widget

`packages/widget` baut mit Vite im Library-Modus eine einzelne IIFE-Datei `dist/fw-booking-widget.js` (Ziel ES2020, ohne Laufzeitabhängigkeiten). Build: `pnpm --filter @fw-booking/widget build`; lokale Prüfseite: `pnpm --filter @fw-booking/widget demo` (http://localhost:5180/demo/, optional `?calendar=cal_…&api=http://127.0.0.1:3000&service=<ID>`; der Origin muss in `CORS_ALLOWED_ORIGINS` stehen). Der Dev-Server liefert ein später neu gebautes Bundle nicht nach; nach `build` neu starten.

Einbindung je Kalender:

```html
<div
  data-fw-booking-calendar="cal_…"
  data-fw-booking-api="https://buchung.example.de"
  data-fw-booking-privacy-url="https://kunde.example.de/datenschutz"
></div>
<script src="…/fw-booking-widget.js"></script>
```

- **Konfiguration** ausschließlich über die Datenattribute des Containers (Kalenderkennung `cal_…`, absolute http(s)-Basisadresse der API ohne Query und Fragment, Pflicht `data-fw-booking-privacy-url` für den Link an der Datenschutz-Checkbox (http(s), auch relativ zur Seite, Query und Fragment erlaubt), optional `data-fw-booking-service="<Angebots-ID>"` für ein festes Angebot). Ungültige Einbindungen zeigen einen Hinweis im Container und eine Konsolenwarnung ohne Attributwerte (`data-fw-booking-state="error"`).
- **Mehrere Container** je Seite erhalten jeweils eine eigene Instanz mit eigenem API-Client und eigenem Root (`.fw-booking-root`); der vorhandene Inhalt des Containers (z. B. `<noscript>`) wird ersetzt.
- **Einmaliges Laden:** Die erste Ausführung des Scripts installiert `window.FwBooking` (eingefroren, nicht aufzählbar); weitere Script-Tags verwenden es. Initialisierte Container tragen `data-fw-booking-state` und werden weder von einem zweiten Scan noch von einem anderen Widget-Bundle erneut übernommen.
- **Automatische Erkennung** nach `DOMContentLoaded` (bzw. sofort, wenn die Seite schon geladen ist). Für nachträglich eingefügte Container: `FwBooking.scan(element?)`, `FwBooking.mount(container)` (liefert eine bestehende Instanz unverändert) und `FwBooking.unmount(container)`; kein dauerhafter `MutationObserver`.
- **API-Client** (`src/api/client.ts`): Endpunkte der öffentlichen API und `POST …/bookings`, `credentials: 'omit'`, `referrerPolicy: 'no-referrer'`, Zeitlimit 15 s, Abbruch über `AbortSignal`. Fehler als `ApiError` mit `kind` (`network`, `timeout`, `http`), Status, bekanntem fachlichem `code` und `retryAfterSeconds` bei 429. Eine nicht freigegebene Website erscheint im Browser als `network`, weil die 403-Antwort ohne CORS-Header unlesbar ist.
- **Ablauf** (`src/app.ts`): Angebote laden; ohne festes Angebot Angebotsliste (bei genau einem Angebot direkt dessen Ansicht, mit „Alle Angebote“ zurück zur Liste), mit festem Angebot direkt dessen Ansicht bzw. „derzeit nicht buchbar“. Jede Ansicht hat ein eigenes `AbortSignal`; Wechsel und `unmount` brechen laufende Anfragen ab, späte Antworten werden verworfen. Gruppenkurse öffnen die Kursansicht, Einzeltermine die Einzeltermin-Ansicht.
- **Kursansicht** (`src/views/course.ts`): Kurstermine ab dem heutigen Tag in der Zeitzone der Installation in Zeiträumen von 62 Tagen (`SESSION_WINDOW_DAYS`), „Weitere Termine“ lädt den Folgezeitraum; ein leerer Zeitraum beendet die Liste („Keine weiteren Kurstermine im Buchungszeitraum“, Buchungshorizont erreicht). Gruppierung nach lokalem Tag, je Termin Uhrzeit von–bis, Ort und freie Plätze; ausgebuchte Termine bleiben sichtbar, deaktiviert und mit „Ausgebucht“ gekennzeichnet. Lade-, Leer- und Fehlerzustand (mit „Erneut versuchen“) sowie Zeitzonenhinweis, wenn das Gerät eine andere Zeitzone nutzt.
- **Einzeltermin-Ansicht** (`src/views/single.ts`): Monatskalender als Tabelle (eine Zeile je Woche, Mo–So) mit „Vorheriger/Nächster Monat“, höchstens 12 Monate ab dem aktuellen (`MAX_MONTHS_AHEAD`). Wählbar sind nur Tage aus `available-dates` (eine Abfrage je Monat, im aktuellen Monat ab heute; geladene Monate werden für die Dauer der Ansicht gemerkt). Beim Öffnen wird der erste Monat mit freien Tagen gesucht und dessen erster freier Tag vorausgewählt; ohne freie Tage im gesamten Zeitraum „Derzeit sind keine Termine frei“. Ein Tageswechsel lädt `slots?date=` neu, bricht die vorherige Abfrage ab und setzt eine gewählte Uhrzeit zurück. Startzeiten nach Vormittag (bis 11 Uhr), Nachmittag (12–17 Uhr) und Abend (ab 18 Uhr, lokale Stunde) gruppiert, Schaltflächen zeigen den Beginn, `aria-label` Beginn–Ende. Lade-, Leer- und Fehlerzustand getrennt für Tage und Uhrzeiten; ein Tag ohne verbliebene Slots zeigt „An diesem Tag sind inzwischen keine Uhrzeiten mehr frei“.
- **Buchung** (`src/views/booking-form.ts`, `src/views/confirmation.ts`): Nach einer Auswahl erscheint unter der Ansicht die Leiste „Gewählt: … / Weiter zu deinen Angaben“. Der Schritt „Deine Angaben“ ersetzt die Auswahlansicht (sie bleibt mit ihren Daten erhalten, „Termin ändern“ kehrt ohne erneutes Laden zurück) und zeigt Zusammenfassung, Name, E-Mail, Telefon (mit Hinweis auf den Zweck) und die Pflicht-Checkbox mit Link zu den Datenschutzhinweisen (neuer Tab, `noopener noreferrer`). Prüfung im Browser nach den Regeln von `participantSchema` (`src/validation.ts`, Abgleich per Test), Fehler am Feld mit `aria-invalid`/`aria-describedby`, Fokus aufs erste fehlerhafte Feld; Feldpfade einer 400-Antwort (`ApiError.fieldPaths`) werden ebenso zugeordnet. Während der Anfrage sind Absenden und „Termin ändern“ gesperrt („Wird gebucht …“, `aria-busy`), weitere Submits werden ignoriert. Der Idempotenzschlüssel (128 Bit hex über `crypto.getRandomValues`, `src/idempotency.ts`) bleibt für denselben Termin mit denselben Angaben gleich (erneutes Senden nach Netzwerkfehler), jede Änderung und `idempotency_conflict` erzeugen einen neuen. `slot_taken`, `session_full`, `not_bookable` und 404 führen mit Hinweis zurück zur Auswahl (Einzeltermine auf denselben Tag), deren Verfügbarkeit über `api.fresh()` (`cache: 'reload'`) am Browser-Cache vorbei neu geladen wird; Eingaben bleiben erhalten, die Checkbox muss erneut bestätigt werden. `already_booked`, `too_many_bookings`, `rate_limited`, Netzwerk- und Zeitfehler bleiben als Meldung im Formular. Nach Erfolg Bestätigungsansicht („Dein Termin ist gebucht“, Zusammenfassung aus der API-Antwort, Hinweis auf die E-Mail mit Verwaltungslink, „Weiteren Termin buchen“) und Ereignis `fw-booking:booked` (`detail`: `{ calendarId, bookingId, type, serviceId, serviceTitle, startsAt, endsAt, timeZone }`, keine Teilnehmerdaten); Eingaben werden danach verworfen.
- **Auswahl:** Ein freier Termin wird per `aria-pressed` markiert und in `instance.selection` gehalten; jede Änderung löst am Container das bubbelnde Ereignis `fw-booking:select` aus (`detail`: `{ type: 'group', calendarId, serviceId, sessionId, startsAt, endsAt, timeZone }`, `{ type: 'single', calendarId, serviceId, startsAt, endsAt, timeZone }` oder `null` beim Zurück zur Liste bzw. Tageswechsel). Keine personenbezogenen Daten.
- **Sichere Ausgabe** (`src/dom.ts`): Elemente nur über `createElement`/`textContent`, Klassen automatisch mit Präfix `fw-booking-`, Schaltflächen mit `type="button"`; sichtbare Trenner `·` (für Screenreader ausgeblendet, Termine tragen ein vollständiges `aria-label`). Texte in `src/messages.ts` (Anrede „du“).
- **Bundle-Wächter** im Vite-Build: Nur Module aus `packages/widget/src` und einzeln freigegebene shared-Dateien (`ALLOWED_SHARED_FILES`, derzeit nur `time/format.ts` über den Export `@fw-booking/shared/format`, reines Intl) sind erlaubt; aus dem shared-Index nur Typ-Importe, damit weder Zod noch Temporal-Polyfill ins Bundle gelangen. Der Build löst Workspace-Pakete über die Bedingung `development` aus dem Quellcode auf. Größenlimit 50 000 Bytes (derzeit rund 27 KB). `src/bundle.test.ts` baut das Bundle und prüft Inhalt, Größe und dreifaches Einbinden in jsdom.

## Öffentliche API (Widget)

Ohne Anmeldung, je öffentlicher Kalenderkennung (`cal_…`, eine je Installation, Migration `004`; für den Owner über `GET /api/owner/calendar`).

| Endpunkt | Inhalt | Cache |
|---|---|---|
| `GET /api/public/calendars/:calendarId/services` | Aktive Angebote in Reihenfolge | 5 Min |
| `GET …/services/:serviceId/slots?date=` | Freie Einzeltermin-Slots; belegte Zeiten erscheinen nicht | 30 s |
| `GET …/services/:serviceId/available-dates?from=&to=` | Tage mit freien Slots (≤ 62 Tage) | 30 s |
| `GET …/services/:serviceId/sessions?from=&to=` | Geplante Kurstermine mit freien Plätzen, ausgebuchte mit 0 (≤ 62 Tage) | 30 s |

Unbekannte Kalender sowie unbekannte oder deaktivierte Angebote ergeben 404. Jede Antwort wird vor dem Senden gegen das strikte Schema aus `@fw-booking/shared` geprüft (`assertPublic`); zusätzliche Felder wie Teilnehmerdaten verhindern die Auslieferung.

## Öffentliche Buchung

`POST /api/public/calendars/:calendarId/bookings` (ohne Anmeldung, JSON, `bookingRequestSchema`). Kursbuchungen laufen in einer Transaktion: Platz per Schreibbedingung `bookedCount < capacity` belegen, Buchung, Outbox-Auftrag `booking_confirmation` und Audit-Eintrag anlegen. Wiederholte Anfragen mit gleichem Idempotenzschlüssel liefern 200 mit derselben Buchung; abweichende Daten 409. Einzeltermine (`type: 'single'`) sind nur zu berechneten Startzeiten buchbar; die Transaktion belegt die 5-Minuten-Einheiten der Dauer in `resourceOccupancy`, der eindeutige Index verhindert Überschneidungen mit anderen Einzelterminen und Kursen. Kurs- und Einzelbuchung teilen Idempotenz, Outbox, Audit und Fehlerbehandlung. Fehler tragen einen Code (`session_full`, `slot_taken`, `not_bookable`, `already_booked`, `idempotency_conflict`).

## Selbstverwaltung über den Verwaltungslink

| Endpunkt | Wirkung |
|---|---|
| `GET /api/public/manage` (Header `X-Booking-Token`) | Ansicht der eigenen Buchung (ohne E-Mail und Telefon), Frist und erlaubte Aktionen |
| `GET /api/public/manage/slots?date=` bzw. `/sessions?from=&to=` | Mögliche neue Termine desselben Angebots (eigene Zeit gilt als frei) |
| `POST /api/public/manage/rebook` `{ type, startsAt \| sessionId, confirm: true }` | Umbuchung in einer Transaktion: alte Buchung `rebooked`, neue Buchung, Platz/Zeit verschieben, Links übertragen, Auftrag `booking_rebooked`, Audit; höchstens einmal |
| `POST /api/public/manage/cancel` `{ confirm: true }` | Storno in einer Transaktion: Status, Freigabe von Kursplatz bzw. Belegungseinheiten, Entwertung aller Links, Outbox-Auftrag `booking_cancellation`, Audit |

`ActionTokenService.issue` erzeugt Links (für den Mail-Worker ab task-3-2); unbekannte Tokens ergeben 404, abgelaufene 410 (`link_expired`), überschrittene Frist 409 (`change_deadline_passed`). Antworten tragen `Cache-Control: no-store` und `Referrer-Policy: no-referrer`.

## Hintergrund-Worker

`apps/worker` ist ein eigener Node.js-Prozess (ohne NestJS) und arbeitet `outboxJobs` ab. Start: `pnpm --filter @fw-booking/worker dev` bzw. nach `pnpm build` `start`; Konfiguration aus derselben `.env` (`MONGODB_URI`, `LOG_LEVEL`, `WORKER_CONCURRENCY` Standard 4, `WORKER_POLL_INTERVAL_MS` Standard 5000).

- **Beanspruchen:** `JobQueue.claim` holt per `findOneAndUpdate` den ältesten fälligen Job eines Typs mit registriertem Handler – `pending` mit `dueAt ≤ jetzt` oder `processing` mit abgelaufener Lease – und setzt `processing`, `leaseUntil` (+5 Minuten), ein zufälliges `leaseToken` und `attempts + 1`. Mehrere Worker erhalten so nie denselben Job gleichzeitig.
- **Ergebnis:** `complete` (`sent`, `completedAt`) und `fail` schreiben nur, wenn `leaseToken` noch passt; ein Worker mit abgelaufener, neu vergebener Lease kann nichts überschreiben.
- **Wiederholungen:** Handler werfen `temporaryFailure(kategorie)` (Wiederholung) oder `permanentFailure(kategorie)` (sofort `failed`); unbekannte Fehler gelten als vorübergehend (`unexpected`). Abstände nach Versuch 1–5: 1, 5, 15, 60, 180 Minuten (±10 %), nach 6 Versuchen `failed` mit `failedAt`. Gespeichert wird nur `lastErrorCategory`, nie die Fehlermeldung. Ein Job, dessen Lease nach dem letzten Versuch abgelaufen ist, wird ohne erneute Ausführung `failed` (`lease_expired`).
- **Zeitlimit:** Handler laufen höchstens 4 Minuten (unter der Lease) und erhalten ein `AbortSignal`; Überschreitung zählt als vorübergehender Fehler `timeout`.
- **Zustellung mindestens einmal:** Stürzt ein Worker nach dem Versand, aber vor `complete` ab, wird der Job nach Ablauf der Lease erneut ausgeführt. Mails tragen deshalb eine stabile Message-ID je Job (`<jobId.typ@absenderdomain>`).
- **Handler:** `src/handlers/index.ts` ordnet Jobtypen Handler zu; Handler liefern `sent` oder `skipped` (gespeichert in `result`). Nur registrierte Typen werden beansprucht, andere bleiben unverändert `pending`; derzeit sind alle fünf Typen registriert.

## E-Mail-Versand

SMTP über `nodemailer` (`src/mail/mailer.ts`); lokal Mailpit (`SMTP_HOST=127.0.0.1`, `SMTP_PORT=1025`, Oberfläche http://127.0.0.1:8025). In Produktion ist eine verschlüsselte Verbindung Pflicht (STARTTLS oder `SMTP_SECURE=true`). Absender und Kontakt je Installation aus Umgebungsvariablen: `MAIL_FROM_ADDRESS` (Anzeigename `BUSINESS_NAME`), optional `MAIL_REPLY_TO`, `BUSINESS_PHONE`, `SMTP_USER`/`SMTP_PASSWORD`. Der Verwaltungslink lautet `MANAGE_PAGE_URL#t=TOKEN` (WordPress-Seite mit Widget, in Produktion nur https); optional verlinken Storno- und Absagemail `BOOKING_PAGE_URL` zum erneuten Buchen.

| SMTP-Fehler | Kategorie | Folge |
|---|---|---|
| Verbindung, DNS, Zeitüberschreitung | `smtp_unavailable` | Wiederholung |
| Anmeldung fehlgeschlagen | `smtp_auth` | Wiederholung (Betreiber kann Zugangsdaten korrigieren) |
| 4xx | `smtp_deferred` | Wiederholung |
| 5xx beim Empfänger (`RCPT TO`) | `recipient_rejected` | sofort `failed` |
| 5xx sonst | `message_rejected` | sofort `failed` |

**Bestätigungsmail** (`booking_confirmation`, `src/handlers/booking-confirmation.ts`): lädt Buchung, Angebot, Kurstermin (Ort) und Einstellungen; ist die Buchung nicht mehr `confirmed`, wird der Job ohne Mail mit `result: 'skipped'` abgeschlossen, fehlt sie, endet er als `booking_missing`. Sonst stellt der Handler über `issueActionToken` (`@fw-booking/db`, gemeinsam mit der API) einen neuen Link aus und versendet Text, HTML und `termin.ics`: Angebot, Datum und Uhrzeit in der Zeitzone der Installation, Ort, Änderungsfrist (Angebot bzw. Installation), Link sowie Kontakt. Nach Ablauf der Frist weist die Mail auf den direkten Kontakt hin. Scheitert der Versand, wird der eben ausgestellte Token wieder gelöscht. Alle Werte werden im HTML maskiert; die Kalenderdatei enthält keinen Verwaltungslink. Logs enthalten nur Job-ID, Typ, Versuch und Kategorie.

**Storno-, Umbuchungs- und Absagemail** (`src/handlers/booking-changes.ts`, Inhalte in `src/mail/changes.ts`; alle Mails teilen das Gerüst `src/mail/layout.ts`):

| Auftrag | Bezug | Versand nur bei Status | Inhalt | Kalenderdatei |
|---|---|---|---|---|
| `booking_cancellation` | stornierte Buchung | `cancelled` | Bestätigung des Stornos, kein Verwaltungslink (alle Links entwertet), optional Link zum erneuten Buchen | `STATUS:CANCELLED` |
| `booking_rebooked` | neue Buchung | `confirmed` | bisheriger und neuer Termin, neue Frist, neuer Verwaltungslink (nur noch Storno möglich), Hinweis auf weiter gültige Links | neue Zeit |
| `owner_cancellation` | abgesagte Buchung (je Teilnehmer ein Auftrag) | `cancelled_by_owner` | Absage mit optionaler Begründung, Entschuldigung, Kontakt, optional Link zum erneuten Buchen | `STATUS:CANCELLED` |

Trägt die Buchung einen anderen Status, wird der Auftrag ohne Mail mit `result: 'skipped'` abgeschlossen (z. B. Umbuchungsmail, wenn die neue Buchung bereits wieder storniert ist). Die Kalenderdatei verwendet immer die UID der ersten Buchung der Umbuchungskette (`booking-<id>@absenderdomain`) mit steigender `SEQUENCE` (Bestätigung 0, Umbuchung 1, Absage +1), damit Kalender-Apps den vorhandenen Eintrag verschieben bzw. als abgesagt markieren. **Deduplizierung:** je Buchung und Anlass höchstens ein Auftrag (eindeutiger `dedupeKey`), ein erledigter Auftrag wird nicht erneut beansprucht, und eine nach Absturz wiederholte Mail trägt dieselbe Message-ID.

**Erinnerung** (`booking_reminder`): `ReminderScheduler` (`src/reminders.ts`) läuft beim Start und jede Minute in jedem Worker-Prozess. Er legt für bestätigte Buchungen einen Auftrag an, sobald `startsAt − reminderLeadMinutes` erreicht ist (Vorlauf aus den Installations-Einstellungen, Standard 1440). Ausgenommen sind Buchungen, die erst innerhalb dieses Fensters entstanden sind (`createdAt > startsAt − Vorlauf`, auch durch Umbuchung), und begonnene Termine. Der Auftrag trägt `scheduledFor` (geplanter Terminbeginn); `dedupeKey` `booking_reminder:<buchungs-id>` verhindert Doppelungen auch bei gleichzeitig planenden Workern. Vor dem Versand prüft der Handler (`src/handlers/booking-reminder.ts`) erneut: Buchung `confirmed`, Termin nicht begonnen, Beginn gleich `scheduledFor`, Kurstermin nicht abgesagt – sonst `skipped`. Die Mail nennt die Termindetails und enthält einen neuen Verwaltungslink (nach einer Umbuchung nur noch Storno), aber keine Kalenderdatei. Genauigkeit des Versandzeitpunkts: etwa eine Minute plus Abfrageabstand.
- **Herunterfahren:** SIGTERM/SIGINT beenden das Abfragen; laufende Jobs werden abgeschlossen, danach endet der Prozess.
- **Aufbewahrung:** Versendete Jobs löscht ein TTL-Index 30 Tage nach `completedAt` (Migration `008`, nur `status: 'sent'`); `failed` bleibt für die Anzeige im Portal. Index `status_leaseUntil` für abgelaufene Leases.

## Nebenläufigkeitstests

`apps/api/src/concurrency/` prüft gegen ein echtes Replica Set sieben Szenarien: Kurs mit N Plätzen (inkl. Doppelklicks), Kapazität senken während gebucht wird, Kurstermin sperren während gebucht wird, Kurstermin absagen während gebucht wird, Kurstermin anlegen gegen Einzelbuchung zur selben Zeit, Erzeugung aus Kursregeln gegen Einzelbuchungen, überlappende Einzelbuchungen mehrerer Angebote. Nach jedem Durchlauf prüft `checkConsistency` die Invarianten (bookedCount = bestätigte Buchungen ≤ Kapazität, Einzelbuchungen belegen genau ihre Dauer, keine verwaisten oder doppelten Belegungen, genau ein Bestätigungsauftrag je Buchung, genau ein Absageauftrag je vom Owner abgesagter Buchung). Normallauf: 50 Anfragen, ein Durchlauf; Lastlauf `test:concurrency`: 200 Anfragen, 20 Durchläufe, Log in `apps/api/logs/`. Der Testclient nutzt höchstens 64 Verbindungen (macOS begrenzt die Verbindungs-Warteschlange auf 128); alle Anfragen werden dennoch gleichzeitig abgeschickt.

## Zentrale Abnahmetests

- Parallele Anfragen auf denselben Einzeltermin-Slot → genau eine Buchung.
- Kurs mit N Plätzen → bei parallelen Anfragen genau N Buchungen.
- Gleicher Idempotenzschlüssel → keine zweite Buchung.
- Mehrfaches Storno gibt Plätze nur einmal frei; fehlgeschlagene Umbuchung erhält die ursprüngliche Buchung.
- Längere Einzeltermine blockieren alle überlappenden Slots, auch anderer Angebote; Kurse blockieren Einzeltermine.
- Sommer-/Winterzeit wird korrekt behandelt.
- Ausfall des E-Mail-Dienstes verliert keine Buchung.
- Nach Logout keine Teilnehmerdaten abrufbar oder im Service-Worker-Cache.
- Zugangsdaten einer Installation eröffnen keinen Zugriff auf eine andere.
- Backups lassen sich wiederherstellen.

Ausführliche Herleitung: `Architektur-Terminbuchung.md` (Ausgangsdokument außerhalb des Repositorys).
