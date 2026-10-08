# Aktueller Projektstand

## Projekt

WP Buchung Kalender plus PWA (`wp-buchung-kalender-plus-pwa`), Status aktiv, Roadmap v2 mit 7 Phasen und 49 Tasks (Gesamtgewicht 98). Fortschritt: 31,63 % (31 von 98 Gewichtspunkten, 15 von 49 Tasks).

## Aktive Phase

phase-2 – Buchungskern (API).

## Aktive Aufgabe

Keine.

## Zuletzt abgeschlossen

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

- task-2-10 – Atomare Einzeltermin-Buchung (Planung abgestimmt: nur berechnete Startzeiten, unbegrenzt je E-Mail, Fehler `slot_taken`/`not_bookable`)
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
- Bei wiederholten Läufen der Buchungstests schlugen einmal (in rund 40 Läufen) 2 Tests fehl. Die Ausgabe wurde nicht gesichert; der Fehler ließ sich danach weder durch Wiederholung, Parallelbetrieb noch einen Stresstest reproduzieren. Vermutung: Zeitüberschreitung unter Last, nicht bestätigt. In task-2-11 gezielt mit protokollierten Wiederholungsläufen prüfen.

## Empfohlener nächster Schritt

task-2-10 (Atomare Einzeltermin-Buchung, Planung bereits abgestimmt), danach task-2-11 (Nebenläufigkeitstests inkl. Prüfung des einmaligen Testfehlschlags).
