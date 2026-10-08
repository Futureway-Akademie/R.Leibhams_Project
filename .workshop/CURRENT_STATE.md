# Aktueller Projektstand

## Projekt

WP Buchung Kalender plus PWA (`wp-buchung-kalender-plus-pwa`), Status aktiv, Roadmap v2 mit 7 Phasen und 49 Tasks (Gesamtgewicht 98). Fortschritt: 38,78 % (38 von 98 Gewichtspunkten, 18 von 49 Tasks).

## Aktive Phase

phase-2 – Buchungskern (API).

## Aktive Aufgabe

Keine.

## Zuletzt abgeschlossen

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

- task-2-13 – Umbuchung
- task-2-14 – Teilnehmerliste und Owner-Absage
- task-2-15 – Missbrauchsschutz und CORS
- task-3-1 – Worker mit Job-Leases
- task-4-1 – Widget-Build
- task-5-1 – Portal-Gerüst und Login
- task-7-1 – Geschützter Entwicklerzugang

## Blockiert

Nichts.

## Wichtige Entscheidungen

Siehe `docs/decisions.md`. Neu (2026-10-08): Einzeltermine bieten jede passende Startzeit im 5-Minuten-Raster an, Slot-Raster und Puffer entfallen (Dauer enthält Puffer); nur berechnete Startzeiten buchbar; unbegrenzt viele Einzeltermine je E-Mail. Davor: Kursbuchung in einer Transaktion mit Kapazitätsprüfung in der Schreibbedingung, eine aktive Buchung je E-Mail und Kurstermin, Verwaltungslink nur per E-Mail (Token erst beim Versand), Pflicht-Checkbox für Datenschutzhinweise, 409 bei Idempotenzkonflikt, fachliche Fehlercodes für das Widget.

## Bekannte Probleme

- PHP ist auf dem Entwicklungsrechner nicht installiert; wird für task-4-7 benötigt.
- In der lokalen Datenbank existiert kein Owner-Konto; bei Bedarf mit `pnpm --filter @fw-booking/api owner:create --email …` anlegen.
- `availableDates` berechnet jeden Tag einzeln (mehrere Abfragen pro Tag); bei Bedarf später optimieren.
- `progress.json` wird von einem strikten Validator (ajv ohne Toleranz) bei manchen korrekt gerundeten Werten abgelehnt, z. B. `overall: 34.69`, weil `multipleOf: 0.01` im Schema an Gleitkomma-Rundung scheitert (34.69 / 0.01 = 3468.9999999999995). Mit Toleranz (`--multiple-of-precision=2`) gültig. Betrifft das Schema der Workshop-Vorlage bzw. das Dashboard; nicht eigenmächtig geändert.
- Geklärt: Der sporadische Testfehlschlag aus task-2-9 war ein Testfehler (Prüfmuster `/030/` traf Ziffern in Hex-IDs), behoben in task-2-10.

## Empfohlener nächster Schritt

task-2-13 (Umbuchung), die direkt auf Verwaltungslink und Storno aufbaut.
