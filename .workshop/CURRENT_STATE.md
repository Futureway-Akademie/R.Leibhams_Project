# Aktueller Projektstand

## Projekt

WP Buchung Kalender plus PWA (`wp-buchung-kalender-plus-pwa`), Status aktiv, Roadmap v1 mit 7 Phasen und 48 Tasks (Gesamtgewicht 97). Fortschritt: 10,31 % (10 von 97 Gewichtspunkten, 6 von 48 Tasks).

## Aktive Phase

phase-2 – Buchungskern (API).

## Aktive Aufgabe

Keine.

## Zuletzt abgeschlossen

- task-2-1 – API-Grundgerüst (NestJS 12 + Express, MongoDB-Treiber, `/health`, Pino mit Log-Schwärzung; 14 Tests)
- task-1-5 – Zeitzonen-Utilities
- task-1-4 – Shared-Paket: Domänentypen und Validierung
- task-1-3 – Lokale Infrastruktur
- task-1-2 – Monorepo-Gerüst
- task-1-1 – Fachregeln dokumentieren

## Bereite nächste Aufgaben

- task-2-2 – Collections, Indizes und Provisionierung
- task-4-1 – Widget-Build
- task-7-1 – Geschützter Entwicklerzugang

## Blockiert

Nichts.

## Wichtige Entscheidungen

Siehe `docs/decisions.md`: eigenes Verwaltungsportal als PWA, Widget ohne iframe im Light DOM, getrennte Installation je Kunde, zwei Terminarten, eine Ressource je Installation, ein Platz pro Buchung, Fachregeln zu Fristen und Pflichtfeldern, Monorepo-Werkzeuge, lokale MongoDB ohne Auth nur an localhost, Zod 4 mit englischen Bezeichnern, ObjectId-Strings und UTC-Zeitpunkten, temporal-polyfill für Zeitumrechnung, API mit Express, nativem MongoDB-Treiber, nestjs-pino und SWC.

## Bekannte Probleme

- PHP ist auf dem Entwicklungsrechner nicht installiert; wird für task-4-7 benötigt.
- Die API importiert `@fw-booking/shared` noch nicht. Für den Produktions-Build muss das Shared-Paket in task-2-2 mitgebaut bzw. eingebunden werden.

## Empfohlener nächster Schritt

task-2-2 (Collections, Indizes und Provisionierung) als nächster Schritt im Buchungskern.
