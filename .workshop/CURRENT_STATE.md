# Aktueller Projektstand

## Projekt

WP Buchung Kalender plus PWA (`wp-buchung-kalender-plus-pwa`), Status aktiv, Roadmap v2 mit 7 Phasen und 49 Tasks (Gesamtgewicht 98). Fortschritt: 61,22 % (60 von 98 Gewichtspunkten, 30 von 49 Tasks).

## Aktive Phase

phase-4 – Öffentliches Widget und WordPress.

## Aktive Aufgabe

Keine.

## Zuletzt abgeschlossen

- task-4-4 – Buchungsformular (eigener Schritt „Deine Angaben“, Pflicht-Attribut `data-fw-booking-privacy-url`, Prüfung wie `participantSchema`, Doppelklick-Schutz mit stabilem Idempotenzschlüssel, bei `slot_taken`/`session_full` zurück zur Auswahl mit `api.fresh()`, Bestätigungsansicht und `fw-booking:booked`; 141 Widget-Tests, Ende-zu-Ende mit Worker und Mailpit, Bundle 26,5 KB)
- task-4-3 – Slot-Auswahl für Einzeltermine (Monatskalender als Tabelle, höchstens 12 Monate, erster freier Tag vorausgewählt, Startzeiten nach Vormittag/Nachmittag/Abend, Lade-/Leer-/Fehlerzustand für Tage und Uhrzeiten, Auswahl `type: 'single'` über `fw-booking:select`; 95 Widget-Tests, Bundle 17,4 KB)
- task-4-2 – Kursansicht (Angebotsliste oder festes Angebot per `data-fw-booking-service`, Kurstermine nach Tagen mit freien Plätzen, „Weitere Termine“ in 62-Tage-Zeiträumen, ausgebuchte Termine deaktiviert, Lade-/Leer-/Fehlerzustand, Auswahl mit Ereignis `fw-booking:select`; 78 Widget-Tests, Bundle 11,9 KB)
- task-4-1 – Widget-Build (IIFE-Datei `packages/widget/dist/fw-booking-widget.js`, 4,3 KB; Container per `data-fw-booking-calendar`/`data-fw-booking-api`, `window.FwBooking` mit `scan`/`mount`/`unmount`, einmalige Initialisierung je Container, schlanker API-Client mit `ApiError`; Build-Wächter; 41 Widget-Tests)
- task-3-5 – API für fehlgeschlagene Jobs (`/api/owner/notifications/failed` mit Buchungsübersicht, `retry`, `dismiss`, Kategorien mit deutschen Texten in shared, Migration 009; 315 API-Tests) – Phase 3 abgeschlossen
- task-3-4 – Erinnerungen (Planer im Worker, Vorlauf `settings.reminderLeadMinutes`, Prüfung vor Versand, ohne Kalenderdatei; 98 Worker-Tests, Ende-zu-Ende mit Mailpit)
- task-3-3 – Storno-, Umbuchungs- und Absagemails (gemeinsames Mail-Gerüst, Kalender-Aktualisierung über UID/SEQUENCE, optional `BOOKING_PAGE_URL`; 84 Worker-Tests, Ende-zu-Ende mit Mailpit)
- task-3-2 – Bestätigungsmail (SMTP mit nodemailer, Text + HTML + `termin.ics`, Link `MANAGE_PAGE_URL#t=TOKEN`, inaktive Buchungen `skipped`; 65 Worker-Tests, Ende-zu-Ende mit Mailpit)
- task-3-1 – Worker mit Job-Leases (`apps/worker`, Lease-Token, Backoff 1/5/15/60/180 Min, 6 Versuche; Datenmodell und Migrationen nach `packages/db`, Migration 008; 30 Worker-Tests)
- task-2-15 – Missbrauchsschutz und CORS (`CORS_ALLOWED_ORIGINS`, Ratenbegrenzung je IP und je E-Mail, Migration 007, generische Fehlerantworten; 341 API-Tests)
- task-2-14 – Teilnehmerliste und Owner-Absage (`/api/owner/bookings`, `/api/owner/sessions/:id/participants`, Absage von Buchung und Kurstermin mit Auftrag `owner_cancellation`; 303 API-Tests)
- task-2-13 – Umbuchung (`/api/public/manage/rebook`, Links übertragen, höchstens einmal; 280 API-Tests)
- task-2-12 – Action-Tokens und Storno (`/api/public/manage`, Token im Link-Fragment und Header; 265 API-Tests)
- task-2-11 – Nebenläufigkeitstests (6 Szenarien, Konsistenz-Check, Lastlauf `test:concurrency` 200 × 20 ohne Abweichung)
- task-2-10 – Atomare Einzeltermin-Buchung (Belegung der Dauer in einer Transaktion, gemeinsamer Abschluss mit Kursbuchung; 241 API-Tests)
- task-2-16 – Slot-Startzeiten im 5-Minuten-Raster, ohne Puffer (Migration 006; Bartrasur 20 Min in 12–13 Uhr → 12:00–12:40)
- task-2-9 – Atomare Kursbuchung (`POST /api/public/calendars/:calendarId/bookings`, Transaktion mit bedingtem `$inc`, Idempotenz, Outbox, Pflicht-Datenschutzbestätigung, Migration 005; 227 API-Tests)
- task-2-8 – Öffentliche Verfügbarkeits-API
- task-2-7 – Kurstermine und Kursregeln
- task-2-6 – Freie Slots berechnen
- task-2-5 – Öffnungszeiten und Ausnahmen
- task-2-4 – Angebote mit Terminart
- task-2-3 – Owner-Login und Logout
- task-2-2 – Collections, Indizes und Provisionierung
- task-2-1 – API-Grundgerüst
- task-1-1 bis task-1-5 – Phase 1 (abgeschlossen)

## Bereite nächste Aufgaben

- task-4-5 – CSS-Schnittstelle und Barrierefreiheit
- task-4-6 – Self-Service-Seite
- task-5-1 – Portal-Gerüst und Login
- task-7-1 – Geschützter Entwicklerzugang

## Blockiert

Nichts.

## Wichtige Entscheidungen

Siehe `docs/decisions.md`. Neu (2026-10-09): Buchungsformular als eigener Schritt, Pflicht-Datenschutzadresse am Container, stabiler Idempotenzschlüssel je Termin und Angaben, nach Konflikt Auswahl am Browser-Cache vorbei neu laden, Ereignis `fw-booking:booked` ohne Teilnehmerdaten. Davor: Slot-Auswahl als Monatskalender mit einer `available-dates`-Abfrage je Monat, Vorauswahl des ersten freien Tages, Startzeiten nach Tageszeit gruppiert. Davor: Kursansicht mit Angebotsliste oder festem Angebot, Nachladen in 62-Tage-Zeiträumen (leerer Zeitraum beendet die Liste), ausgebuchte Termine sichtbar, Auswahl als Ereignis `fw-booking:select`, `@fw-booking/shared/format` als einzige freigegebene shared-Datei im Bundle. Davor: Widget als IIFE-Datei (ES2020) mit Konfiguration über Datenattribute am Container, automatischer Erkennung plus `window.FwBooking` statt `MutationObserver`, aus `@fw-booking/shared` nur Typ-Importe (Build-Wächter). Davor (2026-10-08): Owner-API für fehlgeschlagene Benachrichtigungen mit erneutem Versuch und Ausblenden, Fehlerkategorien als feste Aufzählung. Davor: Erinnerungen über einen minütlichen Planer im Worker (Vorlauf aus den Installations-Einstellungen, Prüfung vor Versand). Davor: Storno-, Umbuchungs- und Absagemails mit Statusprüfung (sonst skipped), Kalenderdatei mit UID der ersten Buchung und steigender SEQUENCE, optionaler Link zum erneuten Buchen. Davor: Bestätigungsmail mit Absender und Link-Ziel aus Umgebungsvariablen, Kalenderdatei ohne Link, Token bei Versandfehler gelöscht, inaktive Buchungen übersprungen. Davor: Worker als eigener Node.js-Prozess mit Paket `@fw-booking/db` für Datenmodell und Migrationen, Lease 5 Min mit Token, 6 Versuche, versendete Jobs nach 30 Tagen gelöscht, Zustellung mindestens einmal (Mail-Handler brauchen stabile Message-ID je Job). Davor: Freigegebene Origins per `CORS_ALLOWED_ORIGINS` (fremde Origins 403), Ratenbegrenzung im Speicher je IP (IPv6 je /64) und 5 neue Buchungen je E-Mail und Stunde, JSON-Limit 16 KB. Zuvor: Owner-Absage nur bis Terminende, optionale Begründung (nicht im Audit-Log), Belegung abgesagter Kurstermine sofort frei, Teilnehmerliste mit allen Status. Ebenfalls 2026-10-08: Einzeltermine bieten jede passende Startzeit im 5-Minuten-Raster an, Slot-Raster und Puffer entfallen (Dauer enthält Puffer); nur berechnete Startzeiten buchbar; unbegrenzt viele Einzeltermine je E-Mail. Davor: Kursbuchung in einer Transaktion mit Kapazitätsprüfung in der Schreibbedingung, eine aktive Buchung je E-Mail und Kurstermin, Verwaltungslink nur per E-Mail (Token erst beim Versand), Pflicht-Checkbox für Datenschutzhinweise, 409 bei Idempotenzkonflikt, fachliche Fehlercodes für das Widget.

## Bekannte Probleme

- Anfragen, die die CORS-Prüfung mit 403 abweist, erscheinen nicht im Request-Log (die Middleware läuft vor dem Logger). Bei Bedarf in task-7-x (Betrieb) ergänzen.
- PHP ist auf dem Entwicklungsrechner nicht installiert; wird für task-4-7 benötigt.
- In der lokalen Datenbank existiert kein Owner-Konto; bei Bedarf mit `pnpm --filter @fw-booking/api owner:create --email …` anlegen.
- `availableDates` berechnet jeden Tag einzeln (mehrere Abfragen pro Tag); bei Bedarf später optimieren.
- Geklärt: Der sporadische Testfehlschlag aus task-2-9 war ein Testfehler (Prüfmuster `/030/` traf Ziffern in Hex-IDs), behoben in task-2-10.

## Hinweise zur Arbeitsumgebung

- **Docker:** CLI liegt unter `~/.docker/bin` (in `~/.zprofile` eingetragen). In Shells, die vor der Docker-Installation gestartet wurden, `export PATH="$PATH:$HOME/.docker/bin"` setzen. Lokale Infrastruktur: `pnpm infra:up`, Prüfung `pnpm infra:verify`.
- **pnpm:** Version 12 über Corepack; ein Shim liegt in `/opt/homebrew/bin/pnpm` (`corepack enable` nach `/usr/local/bin` war nicht möglich). Build-Skripte sind nur für `@swc/core`, `mongodb-memory-server` und `argon2` freigegeben (`allowBuilds` in `pnpm-workspace.yaml`).
- **Lokale Datenbank:** Migrationen bis `009` sind auf der Docker-MongoDB angewendet (`pnpm --filter @fw-booking/api db:migrate`). Es existiert bewusst kein Owner-Konto.
- **Worker:** `pnpm --filter @fw-booking/worker dev` (gleiche `.env`). Benötigt zusätzlich `MAIL_FROM_ADDRESS`, `BUSINESS_NAME` und `MANAGE_PAGE_URL` (siehe `.env.example`); die lokale `.env` enthält sie noch nicht und wurde bewusst nicht verändert. Mails landen lokal in Mailpit (http://127.0.0.1:8025). Registriert sind alle fünf Jobtypen; der Erinnerungsplaner läuft im selben Prozess. Für manuelle Tests von Erinnerungen den Vorlauf `settings.reminderLeadMinutes` vorübergehend verkürzen und danach auf 1440 zurücksetzen. Migrationen liegen jetzt in `packages/db/src/migrations/`, ausgeführt weiterhin über `pnpm --filter @fw-booking/api db:migrate`.
- **CORS lokal:** Für Widget-Tests im Browser den Origin des Entwicklungsservers in `.env` unter `CORS_ALLOWED_ORIGINS` eintragen; ohne Eintrag lehnt die API Browser-Anfragen anderer Origins mit 403 ab. Für manuelle Lasttests die Grenzen per `RATE_LIMIT_*=0` abschalten.
- **Manuelle Tests:** Bisheriges Vorgehen je Task: temporären Owner mit zufälligem Passwort per `owner:create` anlegen, API mit `pnpm --filter @fw-booking/api dev` starten, Endpunkte per `curl` prüfen, danach Testdaten und Owner in der Docker-MongoDB wieder entfernen. Verwaltungslinks entstehen seit task-3-2 echt: Worker mit Mail-Variablen starten, Link aus der Mail in Mailpit lesen (API `http://127.0.0.1:8025/api/v1/search?query=to:…`), Testmails danach per `DELETE /api/v1/messages` mit ihren IDs entfernen. Hilfsskripte gehören ins Scratchpad bzw. werden nach Gebrauch gelöscht, nie ins Repository.
- **Prüfung der Zustandsdateien:** `roadmap.json`, `project.json` und `progress.json` mit `ajv` gegen die Schemas unter `.workshop/schemas/`.
- **Tests:** Bei Änderungen am Buchungskern zusätzlich `pnpm --filter @fw-booking/api test:concurrency` (7 Szenarien) und mehrere protokollierte Läufe von `pnpm exec vitest run src/bookings` (in `apps/api`). Prüfungen auf fehlende personenbezogene Daten immer mit vollständigen Testwerten, nicht mit kurzen Ziffernfolgen (Hex-IDs).
- **Arbeitsweise mit dem Teilnehmer:** Pro Task wird gemeinsam geplant (offene Entscheidungen als Auswahlfragen mit Empfehlung), dann umgesetzt; nach Abschluss pusht der Agent auf Wunsch („push zu github“) direkt auf `main`.

## Hinweise für Phase 4 (Widget und WordPress)

- **Stand:** task-4-1 bis task-4-4 sind fertig (Build, Kursansicht, Slot-Auswahl, Buchungsformular), siehe `docs/architecture.md`, Abschnitt „Öffentliches Widget“. Aufbau: `src/app.ts` (Ablauf: Angebote → Auswahl mit Leiste „Weiter“ → Formular → Bestätigung, AbortSignal je Ansicht, Ereignisse `fw-booking:select` und `fw-booking:booked`), `src/views/` (`services.ts`, `course.ts`, `single.ts`, `booking-form.ts`, `confirmation.ts`, `summary.ts`, `service-header.ts`, `common.ts`), `src/dom.ts`, `src/messages.ts` (alle Texte, Anrede „du“), `src/time.ts`, `src/validation.ts`, `src/idempotency.ts`, `src/api/client.ts` (`fresh()` umgeht den Browser-Cache). Test-Helfer in `src/test-utils.ts` (Router hält Methode, Body, Cache-Modus und Signal fest).
- **Für task-4-5 (CSS und Barrierefreiheit):** Das Widget ist bisher völlig ungestylt; alle Elemente tragen Klassen mit Präfix `fw-booking-` (Root `.fw-booking-root`). Zustände als Modifier (`--selected`, `--full`, `--free`, `--error`, `--warning`, `--info`) bzw. Attribute (`aria-pressed`, `aria-invalid`, `aria-current="date"`, `aria-busy`, `disabled`, `hidden`). Fokus wird bei Schrittwechsel auf die Überschrift gesetzt (`tabindex="-1"`). Offen: CSS ausliefern (eigenes Stylesheet oder im Bundle injiziert), Custom Properties, sichtbarer Fokus, Tastaturbedienung des Monatskalenders (derzeit Tab-Reihenfolge über alle Tage) und Prüfung, dass `hidden` nicht vom Theme überschrieben wird.
- **Für task-4-6 (Self-Service-Seite):** `MANAGE_PAGE_URL#t=TOKEN` zeigt auf die Seite mit dem Widget; die Erkennung des Fragments und die Verwaltungsansicht fehlen noch (Hinweise unten). `ApiClient` hat noch keine Verwaltungs-Endpunkte.
- **WordPress (task-4-7):** `plugins/wordpress` enthält nur eine README; das Plugin muss `data-fw-booking-privacy-url` (z. B. aus `get_privacy_policy_url()`) setzen.
- **Bundle-Wächter:** Laufzeitcode aus `@fw-booking/shared` bricht den Build ab, außer den in `ALLOWED_SHARED_FILES` (`packages/widget/vite.config.ts`) freigegebenen Dateien; derzeit nur `time/format.ts`, importiert über den Subpath-Export `@fw-booking/shared/format`. Aus dem Index von shared nur Typ-Importe (sonst Zod). Konstanten aus Zod-Modulen (z. B. `MAX_AVAILABLE_DATES_RANGE_DAYS`) im Widget spiegeln und per Test abgleichen. Größenlimit 50 000 Bytes.
- **Demo-Seite:** `pnpm --filter @fw-booking/widget demo` (baut und startet Vite auf http://localhost:5180/demo/, optional `?calendar=cal_…&api=http://127.0.0.1:3000&service=<ID>`; Auswahl-Ereignisse erscheinen in der Konsole; der Dev-Server liefert ein neu gebautes Bundle erst nach einem Neustart aus). API dafür mit `CORS_ALLOWED_ORIGINS=http://localhost:5180 pnpm --filter @fw-booking/api dev` starten (Umgebungsvariable hat Vorrang vor `.env`, `.env` bleibt unverändert). Lokaler Kalender: `cal_Z8XdgTHf5Gys-5YA`, derzeit ohne Angebote. Ende-zu-Ende mit Mails (task-4-4): Worker mit `MAIL_FROM_ADDRESS=… BUSINESS_NAME=… MANAGE_PAGE_URL=http://localhost:5180/demo/ pnpm --filter @fw-booking/worker dev` (nur Umgebungsvariablen), Mails in Mailpit danach per `DELETE /api/v1/messages` mit den IDs entfernen. Testdaten wie in task-4-2/4-3: temporärer Owner, Angebote, Kurstermine (Kapazität ≥ 2, Ausgebucht per `bookedCount` in Mongo), Öffnungszeiten (`PUT /api/owner/opening-hours`, Wochentage 1–7) und Ausnahmen (`kind: 'closed'` bzw. `'extra_opening'`) über die Owner-API; danach alle Dokumente außer `settings` und `_migrations` löschen. Die öffentliche Angebotsliste wird bis zu 5 Minuten im Browser gecacht; Fehlerzustände daher über Kurstermine (30 s) prüfen. Hintergrundserver gezielt per PID beenden (`lsof -nP -iTCP:<port> -sTCP:LISTEN`), `pkill` mit Muster hat den Vite-Server in task-4-1 verfehlt.
- **Verbindliche Rahmenbedingungen** (`.workshop/specialization/CONSTRAINTS.md`): Light DOM ohne iframe, alle Klassen mit Präfix `fw-booking-`, kein ungeprüftes HTML aus Daten (DOM sicher erzeugen), keine Zugangsdaten im Browser.
- **Öffentliche API für das Widget** (`docs/architecture.md`, Abschnitte „Öffentliche API (Widget)“, „Öffentliche Buchung“, „Selbstverwaltung über den Verwaltungslink“): Angebote, Slots, verfügbare Tage, Kurstermine, `POST …/bookings` (Idempotenzschlüssel, `privacyAccepted: true`), fachliche Fehlercodes (`session_full`, `slot_taken`, `not_bookable`, `already_booked`, `idempotency_conflict`, `too_many_bookings`, `rate_limited`, `origin_not_allowed`). Schemas und Typen kommen aus `@fw-booking/shared`; Anzeige von Zeiten mit `formatDate`/`formatTime` aus `packages/shared/src/time/format.ts` (nur Intl, kein Polyfill im Widget).
- **CORS und Grenzen:** Der Origin der Test-Seite muss in `.env` unter `CORS_ALLOWED_ORIGINS` stehen, sonst 403. Ratenbegrenzung je IP aktiv (Lesen 120/Min); für Browser-Tests ausreichend, für Lasttests `RATE_LIMIT_*=0`.
- **Self-Service-Seite (task-4-6):** Mails verlinken `MANAGE_PAGE_URL#t=TOKEN`. Die Seite liest das Token aus dem Fragment, sendet es im Header `X-Booking-Token` an `/api/public/manage…` und darf es nie in URL-Pfad, Query, Referrer oder Analytics bringen (Fragment nach dem Lesen entfernen, z. B. `history.replaceState`). Storno und Umbuchung nur mit `{ confirm: true }`.
- **Browser-Prüfung:** Im Desktop-App-Browser (Browser-Pane) die Demo-Seite öffnen. Von einem nicht freigegebenen Origin meldet der Client `kind: 'network'` (403 ohne CORS-Header ist im Browser unlesbar).
- **WordPress (task-4-7):** PHP ist lokal nicht installiert; vor task-4-7 mit dem Teilnehmer klären (z. B. WordPress per Docker in `infra/`).

## Empfohlener nächster Schritt

task-4-5 (CSS-Schnittstelle und Barrierefreiheit), damit das Widget auf echten Seiten nutzbar aussieht und per Tastatur vollständig bedienbar ist; danach task-4-7 (WordPress-Plugin). Alternativ task-4-6 (Self-Service-Seite) oder Phase 5 mit task-5-1 (Portal-Gerüst und Login).
