# Aktueller Projektstand

## Projekt

WP Buchung Kalender plus PWA (`wp-buchung-kalender-plus-pwa`), Status aktiv, Roadmap v2 mit 7 Phasen und 49 Tasks (Gesamtgewicht 98). Fortschritt: 46,94 % (46 von 98 Gewichtspunkten, 22 von 49 Tasks).

## Aktive Phase

phase-3 – Hintergrund-Worker und E-Mail.

## Aktive Aufgabe

Keine.

## Zuletzt abgeschlossen

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

- task-3-2 – Bestätigungsmail
- task-3-5 – API für fehlgeschlagene Jobs
- task-4-1 – Widget-Build
- task-5-1 – Portal-Gerüst und Login
- task-7-1 – Geschützter Entwicklerzugang

## Blockiert

Nichts.

## Wichtige Entscheidungen

Siehe `docs/decisions.md`. Neu (2026-10-08): Worker als eigener Node.js-Prozess mit Paket `@fw-booking/db` für Datenmodell und Migrationen, Lease 5 Min mit Token, 6 Versuche, versendete Jobs nach 30 Tagen gelöscht, Zustellung mindestens einmal (Mail-Handler brauchen stabile Message-ID je Job). Davor: Freigegebene Origins per `CORS_ALLOWED_ORIGINS` (fremde Origins 403), Ratenbegrenzung im Speicher je IP (IPv6 je /64) und 5 neue Buchungen je E-Mail und Stunde, JSON-Limit 16 KB. Zuvor: Owner-Absage nur bis Terminende, optionale Begründung (nicht im Audit-Log), Belegung abgesagter Kurstermine sofort frei, Teilnehmerliste mit allen Status. Ebenfalls 2026-10-08: Einzeltermine bieten jede passende Startzeit im 5-Minuten-Raster an, Slot-Raster und Puffer entfallen (Dauer enthält Puffer); nur berechnete Startzeiten buchbar; unbegrenzt viele Einzeltermine je E-Mail. Davor: Kursbuchung in einer Transaktion mit Kapazitätsprüfung in der Schreibbedingung, eine aktive Buchung je E-Mail und Kurstermin, Verwaltungslink nur per E-Mail (Token erst beim Versand), Pflicht-Checkbox für Datenschutzhinweise, 409 bei Idempotenzkonflikt, fachliche Fehlercodes für das Widget.

## Bekannte Probleme

- Anfragen, die die CORS-Prüfung mit 403 abweist, erscheinen nicht im Request-Log (die Middleware läuft vor dem Logger). Bei Bedarf in task-7-x (Betrieb) ergänzen.
- PHP ist auf dem Entwicklungsrechner nicht installiert; wird für task-4-7 benötigt.
- In der lokalen Datenbank existiert kein Owner-Konto; bei Bedarf mit `pnpm --filter @fw-booking/api owner:create --email …` anlegen.
- `availableDates` berechnet jeden Tag einzeln (mehrere Abfragen pro Tag); bei Bedarf später optimieren.
- `progress.json` wird von einem strikten Validator (ajv ohne Toleranz) bei manchen korrekt gerundeten Werten abgelehnt, z. B. `overall: 34.69`, weil `multipleOf: 0.01` im Schema an Gleitkomma-Rundung scheitert (34.69 / 0.01 = 3468.9999999999995). Mit Toleranz (`--multiple-of-precision=2`) gültig. Betrifft das Schema der Workshop-Vorlage bzw. das Dashboard; nicht eigenmächtig geändert.
- Geklärt: Der sporadische Testfehlschlag aus task-2-9 war ein Testfehler (Prüfmuster `/030/` traf Ziffern in Hex-IDs), behoben in task-2-10.

## Hinweise zur Arbeitsumgebung

- **Docker:** CLI liegt unter `~/.docker/bin` (in `~/.zprofile` eingetragen). In Shells, die vor der Docker-Installation gestartet wurden, `export PATH="$PATH:$HOME/.docker/bin"` setzen. Lokale Infrastruktur: `pnpm infra:up`, Prüfung `pnpm infra:verify`.
- **pnpm:** Version 12 über Corepack; ein Shim liegt in `/opt/homebrew/bin/pnpm` (`corepack enable` nach `/usr/local/bin` war nicht möglich). Build-Skripte sind nur für `@swc/core`, `mongodb-memory-server` und `argon2` freigegeben (`allowBuilds` in `pnpm-workspace.yaml`).
- **Lokale Datenbank:** Migrationen bis `008` sind auf der Docker-MongoDB angewendet (`pnpm --filter @fw-booking/api db:migrate`). Es existiert bewusst kein Owner-Konto.
- **Worker:** `pnpm --filter @fw-booking/worker dev` (gleiche `.env`). Ohne registrierte Handler (bis task-3-2) beansprucht er keine Jobs. Migrationen liegen jetzt in `packages/db/src/migrations/`, ausgeführt weiterhin über `pnpm --filter @fw-booking/api db:migrate`.
- **CORS lokal:** Für Widget-Tests im Browser den Origin des Entwicklungsservers in `.env` unter `CORS_ALLOWED_ORIGINS` eintragen; ohne Eintrag lehnt die API Browser-Anfragen anderer Origins mit 403 ab. Für manuelle Lasttests die Grenzen per `RATE_LIMIT_*=0` abschalten.
- **Manuelle Tests:** Bisheriges Vorgehen je Task: temporären Owner mit zufälligem Passwort per `owner:create` anlegen, API mit `pnpm --filter @fw-booking/api dev` starten, Endpunkte per `curl` prüfen, danach Testdaten und Owner in der Docker-MongoDB wieder entfernen. Verwaltungslinks für Tests entstehen bis task-3-2 durch direktes Einfügen eines SHA-256-Token-Hashes in `actionTokens`.
- **Prüfung der Zustandsdateien:** `roadmap.json` und `project.json` mit `ajv` gegen die Schemas; `progress.json` mit `--multiple-of-precision=2` (siehe Bekannte Probleme).
- **Tests:** Bei Änderungen am Buchungskern zusätzlich `pnpm --filter @fw-booking/api test:concurrency` (7 Szenarien) und mehrere protokollierte Läufe von `pnpm exec vitest run src/bookings` (in `apps/api`). Prüfungen auf fehlende personenbezogene Daten immer mit vollständigen Testwerten, nicht mit kurzen Ziffernfolgen (Hex-IDs).
- **Arbeitsweise mit dem Teilnehmer:** Pro Task wird gemeinsam geplant (offene Entscheidungen als Auswahlfragen mit Empfehlung), dann umgesetzt; nach Abschluss pusht der Agent auf Wunsch („push zu github“) direkt auf `main`.

## Empfohlener nächster Schritt

task-3-2 (Bestätigungsmail): erster echter Handler im Worker (SMTP, lokal Mailpit) mit Verwaltungslink über `ActionTokenService`-Logik; danach task-3-3 und task-3-4. task-3-5 (API für fehlgeschlagene Jobs) ist unabhängig davon startbar.
