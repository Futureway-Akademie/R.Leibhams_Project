# Aktueller Projektstand

## Projekt

WP Buchung Kalender plus PWA (`wp-buchung-kalender-plus-pwa`), Status aktiv, Roadmap v1 mit 7 Phasen und 48 Tasks (Gesamtgewicht 97). Fortschritt: 12,37 % (12 von 97 Gewichtspunkten, 7 von 48 Tasks).

## Aktive Phase

phase-2 – Buchungskern (API).

## Aktive Aufgabe

Keine.

## Zuletzt abgeschlossen

- task-2-2 – Collections, Indizes und Provisionierung (12 Collections, Validatoren, eindeutige Indizes, Migrationen mit `db:migrate`; 48 API-Tests)
- task-2-1 – API-Grundgerüst
- task-1-5 – Zeitzonen-Utilities
- task-1-4 – Shared-Paket: Domänentypen und Validierung
- task-1-3 – Lokale Infrastruktur
- task-1-2 – Monorepo-Gerüst
- task-1-1 – Fachregeln dokumentieren

## Bereite nächste Aufgaben

- task-2-3 – Owner-Login und Logout
- task-4-1 – Widget-Build
- task-7-1 – Geschützter Entwicklerzugang

## Blockiert

Nichts.

## Wichtige Entscheidungen

Siehe `docs/decisions.md`: eigenes Verwaltungsportal als PWA, Widget ohne iframe im Light DOM, getrennte Installation je Kunde, zwei Terminarten, eine Ressource je Installation, ein Platz pro Buchung, Fachregeln zu Fristen und Pflichtfeldern, Monorepo-Werkzeuge, lokale MongoDB ohne Auth nur an localhost, Zod 4 mit englischen Bezeichnern, ObjectId-Strings und UTC-Zeitpunkten, temporal-polyfill, API mit Express, nativem MongoDB-Treiber, nestjs-pino und SWC, BSON-Dates, versionierte Migrationen per eigenem Befehl, DB-Validatoren für kritische Invarianten.

## Bekannte Probleme

- PHP ist auf dem Entwicklungsrechner nicht installiert; wird für task-4-7 benötigt.

## Empfohlener nächster Schritt

task-2-3 (Owner-Login und Logout), weil alle Owner-Endpunkte des Buchungskerns darauf aufbauen.
