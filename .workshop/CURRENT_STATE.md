# Aktueller Projektstand

## Projekt

WP Buchung Kalender plus PWA (`wp-buchung-kalender-plus-pwa`), Status aktiv, Roadmap v1 mit 7 Phasen und 48 Tasks (Gesamtgewicht 97). Fortschritt: 6,19 % (6 von 97 Gewichtspunkten, 4 von 48 Tasks).

## Aktive Phase

phase-1 – Fachliches Modell und Fundament.

## Aktive Aufgabe

Keine.

## Zuletzt abgeschlossen

- task-1-4 – Shared-Paket: Zod-4-Schemas und Domänentypen für beide Terminarten (104 Tests)
- task-1-3 – Lokale Infrastruktur
- task-1-2 – Monorepo-Gerüst
- task-1-1 – Fachregeln dokumentieren

## Bereite nächste Aufgaben

- task-1-5 – Zeitzonen-Utilities
- task-2-1 – API-Grundgerüst
- task-4-1 – Widget-Build

## Blockiert

Nichts.

## Wichtige Entscheidungen

Siehe `docs/decisions.md`: eigenes Verwaltungsportal als PWA, Widget ohne iframe im Light DOM, getrennte Installation je Kunde, zwei Terminarten, eine Ressource je Installation, ein Platz pro Buchung, Fachregeln zu Fristen und Pflichtfeldern, Monorepo-Werkzeuge, lokale MongoDB ohne Auth nur an localhost, Zod 4 mit englischen Bezeichnern, ObjectId-Strings und UTC-Zeitpunkten.

## Bekannte Probleme

- PHP ist auf dem Entwicklungsrechner nicht installiert; wird für task-4-7 benötigt.

## Empfohlener nächster Schritt

task-1-5 (Zeitzonen-Utilities), um Phase 1 abzuschließen; danach task-2-1 für den Buchungskern.
