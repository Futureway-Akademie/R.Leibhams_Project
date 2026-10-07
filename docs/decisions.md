# Entscheidungen

## 2026-10-07 – Grundarchitektur

### Kontext

Terminbuchung soll auf WordPress-Seiten verschiedener Kunden laufen, mobil für Owner nutzbar sein und keine fertige Buchungsplattform verwenden.

### Entscheidung

Eigenständige API mit MongoDB; WordPress-Plugin nur als Integrationsadapter; Widget im Light DOM ohne iframe; eigenes Verwaltungsportal, das zugleich PWA ist; getrennte Installation und Datenbank je Kunde bei gemeinsamem Code.

### Begründung

Eine Oberfläche und ein Login für Desktop und Handy, freie CI-Gestaltung des Widgets, Unabhängigkeit von WordPress-Themes und klare Datentrennung zwischen Kunden.

## 2026-10-07 – Zwei Terminarten

### Kontext

Ein Friseur bedient einen Kunden zur Zeit, ein Yogakurs mehrere Teilnehmer gleichzeitig.

### Entscheidung

Angebote haben eine Terminart: **Einzeltermin** (Slots aus Öffnungszeiten, Dauer und Puffer berechnet, Kapazität 1, Ressourcensperre über Belegungseinheiten) oder **Gruppenkurs** (konkrete bzw. wiederkehrende Kurstermine mit Kapazität > 1). Beide Arten können in einer Installation gemischt werden und teilen sich die Ressource.

### Begründung

Feste Termine passen nicht zu Friseur-Leistungen unterschiedlicher Dauer; berechnete Slots passen nicht zu Kursen mit Teilnehmerlisten.

## 2026-10-07 – Umfangsgrenzen der ersten Version

### Kontext

Die erste Version soll beherrschbar bleiben.

### Entscheidung

Eine Ressource je Installation; eine Buchung umfasst genau einen Platz und eine Person. Mehrere Mitarbeiter und Sammelbuchungen sind spätere Erweiterungen.

### Begründung

Reduziert Komplexität bei Slot-Berechnung und Kapazitätslogik, ohne das Datenmodell für spätere Erweiterungen zu verbauen.

## 2026-10-07 – Fachregeln für Buchung und Fristen

### Kontext

Für den Buchungskern müssen Verbindlichkeit, Slot-Raster, Fristen und Pflichtangaben festgelegt sein.

### Entscheidung

Buchungen sind sofort verbindlich. Slot-Raster je Einzeltermin-Angebot wählbar aus 20, 30, 45, 60, 90 Minuten (Standard 30). Standardfristen: Mindestvorlauf 24 h, Buchungshorizont 90 Tage, Storno/Umbuchung bis 24 h vor Beginn, je Angebot überschreibbar. Pflichtfelder: Name, E-Mail, Telefon. Ressourcenbelegung in 5-Minuten-Einheiten. Details in `docs/domain-rules.md`.

### Begründung

Vom Owner gewählte Produktregeln; die Telefonnummer dient kurzfristigen Rückfragen und muss in den Datenschutzhinweisen des Kunden benannt werden.

## 2026-10-07 – Monorepo-Werkzeuge

### Kontext

Für alle Pakete wird ein einheitliches Gerüst für Lint, Typecheck, Tests und Formatierung benötigt.

### Entscheidung

pnpm-Workspaces (`apps/*`, `packages/*`) mit `pnpm -r` statt Turborepo; Vitest in allen Paketen; ESLint 9 mit typbasiertem `typescript-eslint` (strictTypeChecked) und Prettier über eine zentrale Root-Konfiguration. TypeScript ist auf 6.0 festgelegt, weil `typescript-eslint` 8 TypeScript 7 noch nicht unterstützt. Frameworks (NestJS, React/Vite, Widget-Build) werden erst in ihren eigenen Tasks ergänzt. `plugins/wordpress` ist kein Workspace-Paket.

### Begründung

Ein Runner und eine Lint-Konfiguration halten das Monorepo einfach; ohne Caching-Bedarf bei fünf Paketen bringt Turborepo keinen Mehrwert.

## 2026-10-07 – Lokale Infrastruktur

### Kontext

Buchungen benötigen MongoDB-Transaktionen, die nur in einem Replica Set verfügbar sind; E-Mails sollen lokal ohne echten Versand prüfbar sein.

### Entscheidung

docker-compose unter `infra/` mit MongoDB 8.0 als Single-Node-Replica-Set `rs0` und Mailpit (v1.31.4). Lokal ohne Authentifizierung, alle Ports nur an `127.0.0.1` gebunden. Daten liegen in einem Docker-Volume; `pnpm infra:reset` löscht sie bewusst. Das Replica Set initialisiert sich über den Healthcheck selbst.

### Begründung

Minimaler Einrichtungsaufwand für die Entwicklung bei echter Transaktionsfähigkeit. Authentifizierung und Netzwerkbeschränkung für Kundeninstallationen werden in Phase 7 behandelt.

## 2026-10-07 – Domänentypen und Validierung

### Kontext

API, Portal und Widget benötigen dieselben Typen und Eingaberegeln.

### Entscheidung

`packages/shared` definiert Zod-4-Schemas, aus denen die TypeScript-Typen abgeleitet werden. Technische Bezeichner sind englisch (Zuordnung in `docs/domain-rules.md`, Abschnitt 10). IDs sind ObjectId-Strings, Zeitpunkte ISO-8601 in UTC mit separater `timeZone`. Öffentliche Antwortschemas sind strikt, sodass zusätzliche Felder wie Teilnehmerdaten beim Validieren auffallen. Für Teiländerungen gibt es eigene Schemas ohne Standardwerte, weil Zod Defaults auch in `.partial()` anwendet.

### Begründung

Eine Quelle für Typen und Regeln verhindert Abweichungen zwischen Frontend und API; datenbankabhängige Regeln (z. B. Kapazität nicht unter gebuchte Plätze) bleiben bewusst in der API.

## 2026-10-07 – Zeitzonen-Umrechnung und Anzeige

### Kontext

Öffnungszeiten und Kursregeln sind lokal, Termine werden in UTC gespeichert. Node 24 bietet noch kein natives Temporal.

### Entscheidung

Umrechnung in `packages/shared/src/time/convert.ts` mit `temporal-polyfill`: übersprungene lokale Zeiten liefern `{ ok: false, reason: 'skipped' }`, doppelte ergeben das erste Vorkommen (`disambiguation: 'earlier'`). Anzeige in `time/format.ts` ausschließlich über `Intl.DateTimeFormat` (Standard `de-DE`), damit Widget und Portal den Polyfill nicht laden müssen; `packages/shared` ist als `sideEffects: false` markiert.

### Begründung

Temporal hat die benötigte Disambiguierung eingebaut und kann später durch die native Implementierung ersetzt werden; die Trennung hält das Widget-Bundle klein.

## 2026-10-07 – API-Grundgerüst

### Kontext

Die Buchungs-API braucht Konfiguration, Datenbankzugriff, Healthcheck und Logging als Basis für alle weiteren Endpunkte.

### Entscheidung

NestJS 12 mit Express. Zugriff auf MongoDB über den offiziellen Treiber (kein Mongoose); Validierung bleibt bei den Zod-Schemas. Konfiguration ausschließlich aus Umgebungsvariablen, per Zod geprüft; Fehlermeldungen nennen nur Variablennamen. Die API startet auch ohne erreichbare Datenbank; `GET /health` (außerhalb des Präfixes `/api`) meldet dann 503. Logging mit nestjs-pino: Cookies, Authorization, Set-Cookie, Passwörter, Tokens und Teilnehmerfelder werden geschwärzt, Query-Strings nicht geloggt. Build, Entwicklung und Tests nutzen SWC, weil NestJS Decorator-Metadaten benötigt. Integrationstests laufen gegen mongodb-memory-server mit MongoDB 8.0.32. Installationsskripte sind in pnpm nur für `@swc/core` und `mongodb-memory-server` freigegeben (`allowBuilds`).

### Begründung

Express hat die breiteste Unterstützung für die später benötigten Sessions, CSRF-Schutz und Rate Limiting. Der native Treiber gibt volle Kontrolle über Transaktionen und atomare Updates und vermeidet doppelte Schemadefinitionen. Ein Healthcheck, der Datenbankausfälle meldet statt die API zu beenden, erleichtert Betrieb und Monitoring.

## 2026-10-07 – Datenbankstruktur und Migrationen

### Kontext

Der Buchungskern braucht Collections und Indizes, die Doppelbuchungen und Duplikate datenbankseitig ausschließen. Kundeninstallationen müssen später kontrolliert aktualisiert werden.

### Entscheidung

Zeitpunkte als BSON-Date. Versionierte Migrationen (`001-initial`, …) mit eigenem Runner: angewendete Schritte in `_migrations`, Sperre gegen parallele Läufe, Abbruch bei unbekannten Migrationen in der Datenbank. Ausführung nur über den eigenen Befehl `db:migrate`, nicht beim API-Start. MongoDB-Validatoren prüfen nur kritische Invarianten (Pflichtfelder, Statuswerte, `bookedCount ≤ capacity`, 5-Minuten-Raster, Token-Hash-Format); die vollständigen Regeln bleiben bei Zod. Eindeutige Indizes sichern Ressourcenbelegung, Idempotenz, eine aktive Buchung je E-Mail und Kurstermin sowie idempotente Kurstermin-Erzeugung. Das Shared-Paket wird für die Produktion nach `dist/` gebaut; Entwicklung und Tests nutzen über die Export-Bedingung `development` direkt den Quellcode.

### Begründung

Datenbankseitige Eindeutigkeit ist auch bei gleichzeitigen Anfragen verlässlich. Ein getrennter Migrationsbefehl erlaubt einen eigenen Provisionierungszugang mit erweiterten Rechten, während die API mit eingeschränkten Rechten laufen kann.

## 2026-10-07 – Owner-Anmeldung

### Kontext

Owner-Funktionen in API, Portal und PWA brauchen eine sichere Anmeldung; Tokens dürfen nicht im JavaScript-Speicher liegen.

### Entscheidung

Eigene serverseitige Sitzungen in `authSessions` (nur SHA-256-Hash des Tokens) mit HttpOnly-Cookie, `SameSite=Lax` und `__Host-`-Präfix bei HTTPS; 12 h Inaktivität, maximal 7 Tage, neue Sitzung bei jedem Login. Passwörter mit Argon2id (19 MiB, t=2, p=1). CSRF-Token je Sitzung im Header `X-CSRF-Token`; ändernde Anfragen müssen JSON senden. Globaler Guard mit Freigabe per `@Public()`. Login-Sperre nach 5 Fehlversuchen in 15 Minuten je E-Mail (gehasht gespeichert) und je IP. Owner-Konten nur per CLI `owner:create`.

### Begründung

Serverseitige Sitzungen sind sofort widerrufbar, etwa bei deaktivierten Owners. Der Guard mit Standard-Sperre verhindert, dass eine vergessene Absicherung Owner-Daten offenlegt. Die Sperre je E-Mail kann von Dritten ausgelöst werden; das wird für 15 Minuten in Kauf genommen.

## 2026-10-07 – Angebotsverwaltung

### Kontext

Owner pflegen Angebote beider Terminarten; Widget und Portal brauchen eine vom Owner gewünschte Reihenfolge.

### Entscheidung

Die Terminart ist nach dem Anlegen unveränderlich (Abweichung von der ursprünglichen Regel „änderbar ohne Buchungen“). Angebote werden nur deaktiviert, nie gelöscht. Die Reihenfolge ist manuell über `sortOrder` und den Endpunkt `PUT /api/owner/services/order` (Transaktion, alle IDs genau einmal); neue Angebote kommen ans Ende. Migration `003-service-order` ergänzt Feld, Validator und Index. Änderungen werden mit den geänderten Feldnamen, ohne Werte, im Audit-Log festgehalten.

### Begründung

Eine feste Terminart vermeidet verwaiste Kursregeln, Kurstermine oder Belegungen. Deaktivieren erhält die Historie für Buchungen und Auswertungen.

## 2026-10-07 – Öffnungszeiten und Ausnahmen

### Kontext

Einzeltermine brauchen verlässliche Öffnungsfenster als Grundlage für die Slot-Berechnung, auch an Tagen mit Zeitumstellung.

### Entscheidung

Zeitzone nur bei der Einrichtung festgelegt, für den Owner nur lesbar. Sperrzeit gewinnt gegen zusätzliche Öffnung. Öffnungszeiten und Ausnahmen nur in 5-Minuten-Schritten. Ausnahmen werden angelegt und gelöscht, nicht bearbeitet; Sperrzeiten melden betroffene Buchungen, sagen sie aber nicht ab. Der Wochenplan wird als Ganzes ersetzt. Grenzen in der übersprungenen Stunde gelten ab dem Umstellungszeitpunkt (`localBoundaryToUtc`). Die Fensterberechnung erfolgt mit halboffenen Intervallen in UTC.

### Begründung

Eine feste Zeitzone verhindert, dass alle lokalen Zeiten nachträglich verschoben werden. Der Vorrang der Sperrzeit schützt eingetragenen Urlaub. Das 5-Minuten-Raster passt zu den Belegungseinheiten.

## 2026-10-07 – Slot-Berechnung

### Kontext

Einzeltermine werden nicht gespeichert, sondern aus Öffnungszeiten, Belegung und Fristen berechnet.

### Entscheidung

Raster in lokaler Zeit ab Fensterbeginn; übersprungene Zeiten entfallen, doppelte ergeben das erste Vorkommen. Belegungen werden ausschließlich aus `resourceOccupancy` gelesen, damit Einzeltermine und Kurse dieselbe Quelle nutzen. Die Berechnung erhält `jetzt` als Parameter. Zusätzlich gibt es eine Owner-Vorschau und eine Übersicht freier Tage (max. 62 Tage) für die Monatsansicht im Widget.

### Begründung

Ein lokales Raster entspricht dem, was Kunden auf der Uhr sehen, und vermeidet doppelte Uhrzeiten am Tag der Winterzeitumstellung. Eine einzige Belegungsquelle verhindert widersprüchliche Verfügbarkeiten.

## 2026-10-07 – Kurstermine und Kursregeln

### Kontext

Gruppenkurse brauchen einzelne und wiederkehrende Termine, die sich die Ressource mit Einzelterminen teilen.

### Entscheidung

Kurstermine belegen die Ressource ab dem Anlegen in derselben Transaktion; Überschneidungen scheitern am eindeutigen Index. Uhrzeit nur ohne Buchungen verschiebbar. Regeln sind nach domain-rules 3.3 änderbar: künftige Termine ohne Buchungshistorie werden neu erzeugt, gebuchte bleiben und werden gemeldet. Keine Erzeugung in Sperrzeiten. Nachschub beim API-Start, alle 6 Stunden und bei Regeländerungen. `localStart` bleibt bei Regelterminen der Wiederholungsschlüssel, auch nach dem Verschieben; entfernte Regeltermine werden als abgesagt markiert statt gelöscht, damit die Erzeugung sie nicht neu anlegt. Konflikte werden über den Indexnamen in der Fehlermeldung erkannt, weil Bulk-Fehler kein `keyPattern` liefern.

### Begründung

Eine gemeinsame, datenbankseitig eindeutige Belegung hält Kurse und Einzeltermine konsistent. Der feste Wiederholungsschlüssel und die Markierung als abgesagt verhindern, dass Owner-Eingriffe durch die automatische Erzeugung rückgängig gemacht werden.

## 2026-10-07 – Öffentliche Verfügbarkeits-API

### Kontext

Das Widget braucht Angebote, Slots und Kurstermine ohne Anmeldung, ohne personenbezogene Daten preiszugeben.

### Entscheidung

Eine öffentliche Kalenderkennung je Installation (`cal_…`, per Migration erzeugt, kein Geheimnis). Ausgebuchte Kurstermine werden mit 0 freien Plätzen angezeigt; vergebene Einzeltermine erscheinen nicht. Kurzes Caching: Angebote 5 Minuten, Verfügbarkeiten 30 Sekunden. Öffentliche Antworten werden vor dem Senden gegen strikte Schemas geprüft. Unbekannte, ungültige und deaktivierte Angebote ergeben einheitlich 404.

### Begründung

Interessenten sollen sehen, dass ein Kurs stattfindet, auch wenn er voll ist; bei Einzelterminen wäre eine belegte Uhrzeit ohne Nutzen. Die Schema-Prüfung ist eine zweite Sicherung gegen versehentlich veröffentlichte Daten. Verbindlich bleibt die Prüfung beim Buchen, daher ist kurzes Caching unkritisch.
