# Aktueller Projektstand

## Projekt

WP Buchung Kalender plus PWA (`wp-buchung-kalender-plus-pwa`), Status aktiv, Roadmap v1 mit 7 Phasen und 48 Tasks (Gesamtgewicht 97). Fortschritt: 19,59 % (19 von 97 Gewichtspunkten, 10 von 48 Tasks).

## Aktive Phase

phase-2 – Buchungskern (API).

## Aktive Aufgabe

Keine.

## Zuletzt abgeschlossen

- task-2-5 – Öffnungszeiten und Ausnahmen (`/api/owner/opening-hours`, `/api/owner/availability-exceptions`, `openWindowsForDate`; 135 API-Tests)
- task-2-4 – Angebote mit Terminart
- task-2-3 – Owner-Login und Logout
- task-2-2 – Collections, Indizes und Provisionierung
- task-2-1 – API-Grundgerüst
- task-1-1 bis task-1-5 – Phase 1 (abgeschlossen)

## Bereite nächste Aufgaben

- task-2-6 – Freie Slots berechnen
- task-2-7 – Kurstermine anlegen und wiederkehrend erzeugen
- task-4-1 – Widget-Build
- task-5-1 – Portal-Gerüst und Login
- task-7-1 – Geschützter Entwicklerzugang

## Blockiert

Nichts.

## Wichtige Entscheidungen

Siehe `docs/decisions.md`: eigenes Verwaltungsportal als PWA, Widget ohne iframe, getrennte Installation je Kunde, zwei Terminarten, eine Ressource je Installation, ein Platz pro Buchung, Fachregeln zu Fristen und Pflichtfeldern, Monorepo-Werkzeuge, Zod 4, temporal-polyfill, API mit Express, nativem MongoDB-Treiber, nestjs-pino und SWC, BSON-Dates, versionierte Migrationen, DB-Validatoren, Owner-Anmeldung mit Argon2id und serverseitigen Sitzungen, Terminart unveränderlich, Angebote nur deaktivierbar, manuelle Reihenfolge, Zeitzone nur bei Einrichtung, Sperrzeit vor Zusatzöffnung, 5-Minuten-Raster für Öffnungszeiten und Ausnahmen.

## Bekannte Probleme

- PHP ist auf dem Entwicklungsrechner nicht installiert; wird für task-4-7 benötigt.
- In der lokalen Datenbank existiert kein Owner-Konto; bei Bedarf mit `pnpm --filter @fw-booking/api owner:create --email …` anlegen.

## Empfohlener nächster Schritt

task-2-6 (Freie Slots berechnen), das direkt auf `openWindowsForDate` aufbaut.
