# Projektbrief

## Projektname

WP Buchung Kalender plus PWA

## Idee / Problem

Eine selbst entwickelte Buchungsanwendung für Einzel- und Gruppentermine, unabhängig von fertigen Buchungsplattformen. WordPress dient nur als Einbindungspunkt für den öffentlichen Kalender. Dieselbe Software wird je Kunde in einer getrennten Installation mit eigener MongoDB betrieben und versioniert ausgerollt.

## Zielgruppe

- **Interessenten**, die auf der WordPress-Seite eines Kunden einen Termin buchen.
- **Owner** (z. B. Friseur, Yogastudio), die Angebote, Termine und Teilnehmer am Desktop oder Handy verwalten.
- **Entwickler**, die Kundeninstallationen einrichten und betreiben.

## Zielplattform

Web: eingebettetes JavaScript-Widget im DOM der WordPress-Seite (ohne iframe), Verwaltungsportal als installierbare PWA, Node.js-API und -Worker auf einem Server, MongoDB als Replica Set.

## Kernfunktionen

- Zwei Terminarten, auch gemischt in einer Installation:
  - **Einzeltermin** (z. B. Friseur): freie Slots werden aus Öffnungszeiten, Ausnahmen, Dauer und Puffer berechnet; Kapazität 1.
  - **Gruppenkurs** (z. B. Yoga): konkrete oder wiederkehrende Kurstermine mit Kapazität größer 1.
- Atomare Buchung ohne Doppelbuchung (Transaktion, Idempotenzschlüssel, Ressourcensperre über Belegungseinheiten).
- Storno und Umbuchung per sicherem Link ohne Teilnehmerkonto.
- E-Mail-Bestätigungen, Erinnerungen und Benachrichtigungen über eine persistente Outbox.
- Owner-Portal für Angebote, Öffnungszeiten, Kurstermine, Buchungen und Teilnehmer.
- Mobile PWA mit Übersicht der nächsten Termine, Belegung und Teilnehmernamen.
- Geschützter Entwicklerbereich für die kundeneigene Datenbankanbindung.

## Nicht-Ziele

Online-Zahlungen, Google-/Outlook-Kalenderabgleich, Wartelisten, Teilnehmerkonten, native App-Store-Apps, Mehrpersonal- und Mehrraumplanung, Push-Nachrichten, zentrales Kundenabrechnungsportal, Sammelbuchungen mehrerer Personen.

## MVP

Phasen 1 bis 6: Ein Interessent bucht über das Widget einen Einzeltermin oder Kursplatz, erhält Bestätigung und Erinnerung, kann per Link stornieren oder umbuchen. Der Owner pflegt im Portal Angebote, Öffnungszeiten, Kurstermine und Teilnehmer und sieht auf dem Handy als PWA seine nächsten Termine. Phase 7 ergänzt den produktiven Kundenbetrieb.

Annahmen: eine Ressource je Installation; eine Buchung umfasst genau einen Platz und eine Person.

## Definition of Done

Projektweit gilt für jeden Task zusätzlich zu seinen eigenen Kriterien:

- Implementierung liegt im Repository.
- `pnpm lint`, `pnpm typecheck` und `pnpm test` sind grün (sobald das Monorepo existiert).
- Keine Secrets im Code, in Logs oder im Repository.
- Keine personenbezogenen Daten in öffentlichen API-Antworten.
- Wesentliche Entscheidungen stehen in `docs/decisions.md`.
- Zentraler Zustand unter `.workshop/` ist aktualisiert.

## Technische Rahmenbedingungen

Siehe `.workshop/specialization/STACK.md`, `CONSTRAINTS.md` und `QUALITY_GATE.md` sowie `docs/architecture.md`.
