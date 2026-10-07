# Aktueller Projektstand

## Projekt

WP Buchung Kalender plus PWA (`wp-buchung-kalender-plus-pwa`), Status aktiv, Roadmap v1 mit 7 Phasen und 48 Tasks (Gesamtgewicht 97). Fortschritt: 8,25 % (8 von 97 Gewichtspunkten, 5 von 48 Tasks).

## Aktive Phase

phase-2 – Buchungskern (API). Phase 1 ist abgeschlossen.

## Aktive Aufgabe

Keine.

## Zuletzt abgeschlossen

- task-1-5 – Zeitzonen-Utilities (temporal-polyfill, Intl-Formatierer; 130 Tests im Shared-Paket)
- task-1-4 – Shared-Paket: Domänentypen und Validierung
- task-1-3 – Lokale Infrastruktur
- task-1-2 – Monorepo-Gerüst
- task-1-1 – Fachregeln dokumentieren

## Bereite nächste Aufgaben

- task-2-1 – API-Grundgerüst
- task-4-1 – Widget-Build

## Blockiert

Nichts.

## Wichtige Entscheidungen

Siehe `docs/decisions.md`: eigenes Verwaltungsportal als PWA, Widget ohne iframe im Light DOM, getrennte Installation je Kunde, zwei Terminarten, eine Ressource je Installation, ein Platz pro Buchung, Fachregeln zu Fristen und Pflichtfeldern, Monorepo-Werkzeuge, lokale MongoDB ohne Auth nur an localhost, Zod 4 mit englischen Bezeichnern, ObjectId-Strings und UTC-Zeitpunkten, temporal-polyfill für Zeitumrechnung und Intl für Anzeige.

## Bekannte Probleme

- PHP ist auf dem Entwicklungsrechner nicht installiert; wird für task-4-7 benötigt.

## Empfohlener nächster Schritt

task-2-1 (API-Grundgerüst), da der Buchungskern laut Architektur vor der Oberfläche getestet werden soll.
