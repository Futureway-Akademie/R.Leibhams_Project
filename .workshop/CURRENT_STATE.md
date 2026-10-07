# Aktueller Projektstand

## Projekt

WP Buchung Kalender plus PWA (`wp-buchung-kalender-plus-pwa`), Status aktiv, Roadmap v1 mit 7 Phasen und 48 Tasks (Gesamtgewicht 97). Fortschritt: 4,12 % (4 von 97 Gewichtspunkten, 3 von 48 Tasks).

## Aktive Phase

phase-1 – Fachliches Modell und Fundament.

## Aktive Aufgabe

Keine.

## Zuletzt abgeschlossen

- task-1-3 – Lokale Infrastruktur (MongoDB 8.0 als Replica Set `rs0`, Mailpit; `pnpm infra:*`)
- task-1-2 – Monorepo-Gerüst
- task-1-1 – Fachregeln dokumentieren

## Bereite nächste Aufgaben

- task-1-4 – Shared-Paket: Domänentypen und Validierung
- task-2-1 – API-Grundgerüst

## Blockiert

Nichts.

## Wichtige Entscheidungen

Siehe `docs/decisions.md`: eigenes Verwaltungsportal als PWA, Widget ohne iframe im Light DOM, getrennte Installation je Kunde, zwei Terminarten, eine Ressource je Installation, ein Platz pro Buchung, Fachregeln zu Fristen und Pflichtfeldern, Monorepo-Werkzeuge (pnpm -r, Vitest, ESLint 9 + Prettier, TypeScript 6.0), lokale MongoDB ohne Auth nur an localhost.

## Bekannte Probleme

- PHP ist auf dem Entwicklungsrechner nicht installiert; wird für task-4-7 benötigt.

## Empfohlener nächster Schritt

task-1-4 (Shared-Paket), da es task-1-5 und task-2-2 vorbereitet und die Domänentypen für die API liefert.
