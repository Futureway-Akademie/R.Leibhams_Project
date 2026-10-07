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
