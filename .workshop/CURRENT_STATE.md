# Aktueller Projektstand

## Projekt

WP Buchung Kalender plus PWA (`wp-buchung-kalender-plus-pwa`), Status aktiv, Roadmap v1 mit 7 Phasen und 48 Tasks (Gesamtgewicht 97). Fortschritt: 15,46 % (15 von 97 Gewichtspunkten, 8 von 48 Tasks).

## Aktive Phase

phase-2 – Buchungskern (API).

## Aktive Aufgabe

Keine.

## Zuletzt abgeschlossen

- task-2-3 – Owner-Login und Logout (Argon2id, serverseitige Sitzungen, CSRF, Login-Sperre, CLI `owner:create`; 79 API-Tests)
- task-2-2 – Collections, Indizes und Provisionierung
- task-2-1 – API-Grundgerüst
- task-1-5 – Zeitzonen-Utilities
- task-1-4 – Shared-Paket: Domänentypen und Validierung
- task-1-3 – Lokale Infrastruktur
- task-1-2 – Monorepo-Gerüst
- task-1-1 – Fachregeln dokumentieren

## Bereite nächste Aufgaben

- task-2-4 – Angebote mit Terminart
- task-4-1 – Widget-Build
- task-5-1 – Portal-Gerüst und Login
- task-7-1 – Geschützter Entwicklerzugang

## Blockiert

Nichts.

## Wichtige Entscheidungen

Siehe `docs/decisions.md`: eigenes Verwaltungsportal als PWA, Widget ohne iframe im Light DOM, getrennte Installation je Kunde, zwei Terminarten, eine Ressource je Installation, ein Platz pro Buchung, Fachregeln zu Fristen und Pflichtfeldern, Monorepo-Werkzeuge, lokale MongoDB ohne Auth nur an localhost, Zod 4, temporal-polyfill, API mit Express, nativem MongoDB-Treiber, nestjs-pino und SWC, BSON-Dates, versionierte Migrationen, DB-Validatoren, Owner-Anmeldung mit Argon2id, serverseitigen Sitzungen (12 h / 7 Tage), globalem Guard und Login-Sperre.

## Bekannte Probleme

- PHP ist auf dem Entwicklungsrechner nicht installiert; wird für task-4-7 benötigt.
- In der lokalen Datenbank existiert noch kein Owner-Konto; bei Bedarf mit `pnpm --filter @fw-booking/api owner:create --email …` anlegen.

## Empfohlener nächster Schritt

task-2-4 (Angebote mit Terminart) als erste Owner-Funktion im Buchungskern.
