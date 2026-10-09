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

## 2026-10-07 – Atomare Kursbuchung

### Kontext

Gleichzeitige Anfragen dürfen einen Kurs nie überbuchen; wiederholte Klicks dürfen keine zweite Buchung erzeugen.

### Entscheidung

Kursbuchung in einer MongoDB-Transaktion mit bedingtem `$inc` (`bookedCount < capacity`), Buchung, Outbox-Auftrag und Audit. Eine aktive Buchung je E-Mail und Kurstermin (eindeutiger Teilindex). Gleicher Idempotenzschlüssel mit gleicher Anfrage → 200 mit derselben Buchung, mit anderen Daten → 409. Pflicht-Bestätigung der Datenschutzhinweise (`privacyAccepted: true`, gespeichert als `privacyAcceptedAt`, Migration `005`). Der Verwaltungslink wird nur per E-Mail versendet; das Token entsteht erst beim Versand bzw. in task-2-12 und liegt nie im Klartext in der Datenbank.

### Begründung

Die Prüfung der Kapazität in der Schreibbedingung ist auch bei gleichzeitigen Anfragen verlässlich. Ein Link nur per E-Mail stellt sicher, dass nur Inhaber der Adresse die Buchung ändern können.

## 2026-10-08 – Startzeiten von Einzelterminen

### Kontext

Bei der Planung der Einzeltermin-Buchung (task-2-10) wurde klar, dass die Auswahl „20, 30, 45, 60, 90“ aus task-1-1 als Slot-Raster umgesetzt wurde. Gewünscht ist dagegen: Ein Kunde kann jede Startzeit wählen, die in eine freie Lücke passt, z. B. eine Bartrasur (20 Minuten) in einer freien Stunde 12–13 Uhr um 12:00, 12:05, … bis 12:40. Der Kalender soll die Tagesplanung nicht optimieren.

### Entscheidung

Einzeltermine bieten jede Startzeit im 5-Minuten-Raster an, bei der Dauer und Puffer in eine freie Lücke passen. Das Slot-Raster je Angebot entfällt (neuer task-2-16, Roadmap v2). Gebucht werden kann nur zu berechneten Startzeiten. Eine E-Mail-Adresse darf unbegrenzt viele Einzeltermine buchen; Missbrauchsschutz über Rate Limiting (task-2-15).

### Begründung

Kunden erhalten die größtmögliche Auswahl; die Prüfung gegen berechnete Startzeiten verhindert trotzdem manipulierte Anfragen außerhalb von Öffnungszeiten und Fristen. Der abgeschlossene task-2-6 bleibt historisch erhalten; die Änderung ist als eigener Task nachvollziehbar.

## 2026-10-08 – Kein Puffer

### Kontext

Bisher hatten Einzeltermin-Angebote einen Puffer nach dem Termin (0–60 Minuten).

### Entscheidung

Es gibt keinen Puffer, weder für Einzeltermine noch für Kurse. Die angegebene Dauer eines Angebots enthält einen eventuellen Puffer bereits. Ein Termin belegt die Ressource genau für seine Dauer. Umsetzung in task-2-16 zusammen mit dem Wegfall des Slot-Rasters (Migration `006`).

### Begründung

Einfacher für Owner und Kunden: Eine einzige Angabe bestimmt, wie lange ein Termin den Kalender belegt.

## 2026-10-08 – Einzeltermin-Buchung und Ursache des sporadischen Testfehlschlags

### Kontext

Einzeltermine müssen gleichzeitig gebucht werden können, ohne dass sich Termine überschneiden. Außerdem war in task-2-9 einmal ein nicht reproduzierbarer Testfehlschlag aufgetreten.

### Entscheidung

Einzelbuchung nur zu berechneten Startzeiten; die Transaktion belegt die Einheiten der Dauer, der eindeutige Index auf `resourceOccupancy` ist die harte Garantie (`slot_taken` bei Überschneidung, `not_bookable` ohne berechnete Startzeit). Kurs- und Einzelbuchung teilen einen gemeinsamen Abschluss (Idempotenz, Outbox, Audit, Fehlerbehandlung). Tests, die das Fehlen von Telefonnummern prüfen, vergleichen mit den vollständigen Testwerten statt mit kurzen Ziffernfolgen.

### Begründung

Der sporadische Fehlschlag aus task-2-9 ist geklärt: Das Prüfmuster `/030/` traf gelegentlich zufällige Ziffernfolgen in Hex-IDs der Antwort. Es handelte sich um einen Testfehler, nicht um einen Fehler der Buchungslogik. Nach der Korrektur liefen die Buchungstests 20 von 20 Mal fehlerfrei.

## 2026-10-08 – Nebenläufigkeitstests

### Kontext

Die Garantien des Buchungskerns müssen auch dann halten, wenn Buchungen und Owner-Aktionen gleichzeitig stattfinden.

### Entscheidung

Sechs Szenarien mit gemeinsamem Konsistenz-Check (`checkConsistency`). Im normalen Testlauf einmal mit 50 parallelen Anfragen; zusätzlicher Lastlauf `test:concurrency` mit 200 Anfragen und 20 Durchläufen, Ausgabe in `apps/api/logs/` (nicht versioniert). Die Tests starten die API auf einem echten Port und begrenzen den Client auf 64 Verbindungen mit Keep-Alive.

### Begründung

Ein gemeinsamer Konsistenz-Check deckt auch Fehler auf, die einzelne Statuscodes nicht zeigen. Die Begrenzung der Client-Verbindungen umgeht eine macOS-Grenze (`kern.ipc.somaxconn` = 128), ohne Systemeinstellungen zu ändern; die Anfragen konkurrieren weiterhin gleichzeitig um dieselben Plätze.

## 2026-10-08 – Verwaltungslinks und Storno

### Kontext

Interessenten sollen ihre Buchung ohne Konto ansehen und stornieren können, ohne dass Links unbeabsichtigt Daten preisgeben oder Aktionen auslösen.

### Entscheidung

Token (256 Bit) im Link-Fragment, Übergabe an die API im Header `X-Booking-Token`; nur der Hash wird gespeichert. Mehrere Links je Buchung gleichzeitig gültig bis Terminende; nach Storno werden alle als verbraucht markiert, bleiben aber bis zum Ablauf zur Statusanzeige lesbar. Die Ansicht zeigt Angebot, Zeit, Ort, Status und Namen, nicht E-Mail und Telefon. Storno in einer Transaktion mit genau einmaliger Freigabe; wiederholte Aufrufe sind folgenlos.

### Begründung

Das Fragment wird nie an Server oder Dritte übertragen. Mehrere gültige Links vermeiden, dass ein Klick in einer älteren Mail ins Leere läuft. Weniger angezeigte Daten begrenzen den Schaden bei weitergeleiteten Links.

## 2026-10-08 – Umbuchung

### Kontext

Interessenten sollen über den Verwaltungslink auf einen anderen Termin desselben Angebots wechseln können, ohne die ursprüngliche Buchung zu verlieren, falls das Ziel belegt ist.

### Entscheidung

Umbuchung in einer Transaktion; die alte Buchung wird `rebooked` mit Verweis auf eine neue Buchung. Bisherige Links werden auf die neue Buchung übertragen. Höchstens eine Umbuchung je Buchung (erkennbar am Verweis, ohne neues Feld). Bei Einzelterminen ist ein Verschieben mit Überschneidung der eigenen Zeit erlaubt; die alte Belegung wird in derselben Transaktion ersetzt. Gleichzeitige Doppelklicks liefern „bereits umgebucht“ statt eines Fehlers; dafür wird nach jedem Fehlschlag geprüft, ob bereits auf dasselbe Ziel umgebucht wurde. Der Konsistenz-Check akzeptiert je Buchung entweder einen Bestätigungs- oder einen Umbuchungsauftrag.

### Begründung

Eine neue Buchung statt einer Änderung erhält die Historie. Übertragene Links sind für Kunden am einfachsten. Die Begrenzung auf eine Umbuchung verhindert ständiges Hin- und Herbuchen.

## 2026-10-08 – Teilnehmerliste und Owner-Absage

### Kontext

Der Owner muss Buchungen und Teilnehmer je Termin sehen und Termine oder einzelne Buchungen nachvollziehbar absagen können, ohne dass Plätze doppelt freigegeben oder Benachrichtigungen verloren gehen.

### Entscheidung

Absage eines Kurstermins und einer einzelnen Buchung jeweils in einer Transaktion: Status `cancelled` bzw. `cancelled_by_owner`, Freigabe von Kursplatz, Einzeltermin-Zeit bzw. Ressourcenbelegung des Kurstermins (sofort wieder für Einzeltermine buchbar), Entwertung aller Links (`revoked`), je Buchung ein Outbox-Auftrag `owner_cancellation` (dedupliziert über die Buchungs-ID) und Audit-Einträge. Optionale Begründung (bis 500 Zeichen) wird an Termin und Buchungen gespeichert und später in der Absagemail genutzt, aber nicht ins Audit-Log geschrieben. Absagen sind nur bis zum Terminende möglich (`appointment_ended`); wiederholte Absagen sind folgenlos (`alreadyCancelled`). Die Teilnehmerliste zeigt alle Buchungen eines Termins mit Status; die Buchungsübersicht umfasst ohne Angabe 31 Tage ab heute, höchstens 92 Tage.

### Begründung

Die gemeinsame Transaktion verhindert halbe Absagen; Gleichzeitigkeit mit Buchungen und Stornos wird durch Schreibkonflikte auf demselben Dokument aufgelöst. Die Begründung kann personenbezogene Angaben enthalten und gehört deshalb nicht in das langlebige Audit-Log. Absagen vergangener Termine würden nur sinnlose Mails erzeugen. Die Historie in der Teilnehmerliste macht Stornos und Absagen für den Owner nachvollziehbar.

## 2026-10-08 – Missbrauchsschutz und CORS

### Kontext

Die öffentliche API wird von WordPress-Seiten aus dem Browser aufgerufen und ist ohne Anmeldung erreichbar. Sie muss vor Massenanfragen, Massenbuchungen und Aufrufen von fremden Websites geschützt sein und darf bei ungültigen Eingaben keine internen Details preisgeben.

### Entscheidung

Freigegebene Origins per Umgebungsvariable `CORS_ALLOWED_ORIGINS` (je Installation bei der Einrichtung gesetzt, keine Portal-Oberfläche). Eigene CORS-Middleware nur für `/api/public/*`: fremde Origins erhalten 403 statt nur fehlender Header, damit auch einfache Anfragen keine Buchung auslösen. Ratenbegrenzung je Client-IP (IPv6 je /64) mit festen Fenstern im Speicher der API: Lesen 120/Min, Buchen 10/10 Min, Verwaltungslink-Ansicht 60/Min, Storno/Umbuchung 10/10 Min, per Umgebungsvariable anpassbar. Zusätzlich höchstens 5 neue Buchungen je E-Mail-Adresse und Stunde, gezählt über vorhandene Buchungen. Eigener JSON-Parser (16 KB) mit generischen Fehlerantworten; unbekannte Routen ohne Pfadangabe.

### Begründung

Je Installation läuft eine API-Instanz; Zähler im Speicher vermeiden einen Datenbank-Schreibzugriff bei jedem Slot-Abruf, ein Neustart setzt sie lediglich zurück. Das /64-Netz verhindert das einfache Umgehen über wechselnde IPv6-Adressen. Das Limit je E-Mail ergänzt die IP-Grenzen gegen verteilte Massenbuchungen, ohne die Entscheidung „beliebig viele Einzeltermine je E-Mail“ im Alltag einzuschränken. Origins in der Konfiguration halten die Freigabe beim Betreiber und brauchen keinen zusätzlichen Owner-Endpunkt.

## 2026-10-08 – Worker mit Job-Leases

### Kontext

Bestätigungen, Erinnerungen und weitere Mails müssen unabhängig von Seitenaufrufen zuverlässig versendet werden. Mehrere Worker dürfen einen Auftrag nicht gleichzeitig bearbeiten, abgestürzte Worker dürfen keine Aufträge dauerhaft blockieren, und Versandfehler dürfen weder Buchungen beeinflussen noch Zugangsdaten preisgeben.

### Entscheidung

Eigenständiger Node.js-Worker ohne NestJS. Datenmodell und Migrationen liegen im neuen Paket `@fw-booking/db`, das API und Worker gemeinsam nutzen. Atomare Beanspruchung per `findOneAndUpdate` mit Lease von 5 Minuten ohne Verlängerung und zufälligem Lease-Token; Ergebnisse werden nur mit passendem Token geschrieben. Handler-Zeitlimit 4 Minuten mit `AbortSignal`. 6 Versuche mit Abständen 1, 5, 15, 60, 180 Minuten (±10 %), dauerhafte Fehler sofort `failed`; gespeichert wird nur eine Fehlerkategorie. Nur Jobtypen mit registriertem Handler werden beansprucht. Versendete Jobs werden 30 Tage nach dem Versand per TTL-Index gelöscht, fehlgeschlagene bleiben. Zustellung „mindestens einmal“: Nach einem Absturz zwischen Versand und Abschluss kann ein Job erneut ausgeführt werden.

### Begründung

Ein gemeinsames Datenmodell verhindert auseinanderlaufende Typen zwischen API und Worker. Eine kurze Lease ohne Heartbeat genügt für Mailversand im Sekundenbereich und hält den Code einfach; das Token schützt vor verspäteten Ergebnissen. Die Backoff-Folge überbrückt Mailserver-Ausfälle von einigen Stunden, bevor ein Auftrag im Portal als fehlgeschlagen erscheint. Liegenlassen statt Fehlschlagen nicht registrierter Typen erlaubt es, Mail-Arten schrittweise einzuführen. Die Löschfrist begrenzt das Wachstum der Outbox, ohne die Fehleranzeige zu verlieren.

## 2026-10-08 – Bestätigungsmail

### Kontext

Nach jeder Buchung erhält der Teilnehmer eine Bestätigung mit dem einzigen Zugang zur Selbstverwaltung. Absender und Kontaktdaten unterscheiden sich je Installation; die Seite für die Selbstverwaltung liegt auf der WordPress-Seite des Kunden.

### Entscheidung

Versand im Worker per SMTP (`nodemailer`, feste Versionen, Pakete mindestens zwei Wochen alt). Absender, Antwortadresse, Betriebsname, Telefon und `MANAGE_PAGE_URL` aus Umgebungsvariablen je Installation. Mail mit Text, HTML und Kalenderdatei (`termin.ics`, ohne Verwaltungslink), Anrede mit „du“ wie in Widget-Meldungen. Der Token entsteht beim Versand über die gemeinsame Funktion `issueActionToken` in `@fw-booking/db` und wird bei einem Versandfehler wieder gelöscht. Nicht mehr aktive Buchungen werden ohne Mail mit `result: 'skipped'` abgeschlossen. SMTP-Fehler werden nach Art eingeordnet; abgelehnte Empfänger enden sofort als `failed`, alles Übrige wird wiederholt. Stabile Message-ID je Job.

### Begründung

Umgebungsvariablen passen zur Einrichtung je Kunde und vermeiden einen Owner-Endpunkt vor dem Portal. Die Kalenderdatei erleichtert die Übernahme des Termins; ohne Link bleibt sie unbedenklich, wenn Kalender geteilt oder synchronisiert werden. Das Löschen nicht zugestellter Tokens verhindert verwaiste gültige Links. Überholte Bestätigungen würden Teilnehmer verwirren; Storno-, Umbuchungs- und Absagemails übernehmen die Information.

## 2026-10-08 – Storno-, Umbuchungs- und Absagemails

### Kontext

Teilnehmer sollen jede Änderung ihrer Buchung per Mail erfahren: eigene Stornos, Umbuchungen mit neuem Link und Absagen durch den Owner. Mails dürfen weder doppelt noch überholt ankommen, und der Kalendereintrag aus der Bestätigung soll aktuell bleiben.

### Entscheidung

Drei weitere Handler im Worker mit gemeinsamem Mail-Gerüst. Versand nur, solange die Buchung den zum Auftrag passenden Status trägt, sonst `result: 'skipped'`; Storno und Absage melden Endzustände und werden deshalb immer versendet. Die Umbuchungsmail nennt bisherigen und neuen Termin und stellt einen neuen Link aus (bei Versandfehler wieder entfernt). Kalenderdateien verwenden die UID der ersten Buchung mit steigender `SEQUENCE`; Absagen setzen `STATUS:CANCELLED`. Optionaler Link zum erneuten Buchen über `BOOKING_PAGE_URL`. Die Begründung einer Owner-Absage erscheint einzeilig und maskiert in der Mail, aber nie in Logs.

### Begründung

Ein gemeinsames Gerüst hält alle Mails einheitlich und die Maskierung an einer Stelle. Die Statusprüfung verhindert widersprüchliche Mails bei schnell aufeinanderfolgenden Änderungen. Dieselbe UID erlaubt Kalender-Apps, den bestehenden Eintrag zu verschieben oder als abgesagt zu markieren, statt einen zweiten anzulegen; Apps, die das nicht unterstützen, zeigen die Datei als neuen Eintrag, der Mailtext bleibt maßgeblich.

## 2026-10-08 – Erinnerungen

### Kontext

Teilnehmer sollen vor ihrem Termin erinnert werden, ohne dass stornierte, umgebuchte oder abgesagte Buchungen eine veraltete Erinnerung erhalten. Der Vorlauf soll konfigurierbar sein.

### Entscheidung

Ein Planer im Worker legt jede Minute Erinnerungsaufträge für bestätigte Buchungen an, deren Erinnerungszeitpunkt erreicht ist; der Vorlauf kommt aus `settings.reminderLeadMinutes` (Installation, später im Portal änderbar). Keine Änderung an den Buchungstransaktionen der API. Buchungen, die erst im Erinnerungsfenster entstanden sind, und begonnene Termine erhalten keine Erinnerung. Der Auftrag speichert den geplanten Terminbeginn; vor dem Versand werden Status, Beginn und Kurstermin erneut geprüft, sonst `skipped`. Erinnerung mit neuem Verwaltungslink, ohne Kalenderdatei.

### Begründung

Der Planer leitet die Aufträge aus dem aktuellen Stand ab und berücksichtigt damit Umbuchungen, Stornos und geänderte Vorläufe automatisch; der eindeutige `dedupeKey` macht parallele Planer unbedenklich. Eine Genauigkeit von etwa einer Minute genügt für Erinnerungen. Ohne Kalenderanhang entsteht in keiner Kalender-App ein zweiter Eintrag.

## 2026-10-08 – API für fehlgeschlagene Benachrichtigungen

### Kontext

Endgültig fehlgeschlagene Mails müssen für den Owner sichtbar sein, damit er Teilnehmer auf anderem Weg erreichen oder nach einer Korrektur (z. B. SMTP-Zugangsdaten) erneut versenden kann. Fehlermeldungen von Mailservern dürfen dabei nicht nach außen gelangen.

### Entscheidung

Owner-Endpunkt mit endgültig fehlgeschlagenen, nicht ausgeblendeten Jobs (neueste zuerst, höchstens 200) und einem Zähler für laufende Wiederholungen. Jeder Eintrag enthält eine Kurzübersicht der Buchung mit Kontaktdaten. Aktionen „erneut versuchen“ (Versuche ab 0) und „als erledigt ausblenden“ (bleibt gespeichert), jeweils mit Audit. Kategorien als feste Aufzählung mit deutschen Texten in `@fw-booking/shared`; unbekannte Werte als `unknown`. Antworten werden gegen strikte Schemas geprüft. Der Jobtyp im Datenmodell stammt nun aus derselben Aufzählung.

### Begründung

Mit Kontaktdaten kann der Owner ohne weiteren Abruf reagieren; die Daten sind ohnehin nur für ihn sichtbar. Erneutes Versenden behebt Ausfälle nach einer Korrektur, Ausblenden hält die Liste übersichtlich, ohne Historie zu löschen. Die feste Aufzählung und strikte Schemas garantieren, dass auch künftige Worker-Änderungen keine Fehlertexte oder internen Felder offenlegen.

## 2026-10-09 – Widget-Build und Einbindung

### Kontext

Das öffentliche Widget wird auf beliebigen WordPress-Seiten eingebunden, teils mehrfach auf einer Seite und durch mehrere Shortcodes oder Plugins, die das Script mehrfach ausgeben. Es muss klein bleiben, darf keine Portal- oder Validierungsbibliotheken mitbringen und soll später vom WordPress-Plugin ohne Build-Schritt eingebunden werden.

### Entscheidung

Eine einzelne IIFE-Datei aus einem eigenen Vite-Library-Build (Ziel ES2020). Konfiguration ausschließlich über Datenattribute am Container (`data-fw-booking-calendar`, `data-fw-booking-api`). Automatische Erkennung beim Laden plus öffentliche API `window.FwBooking` mit `scan`, `mount` und `unmount`, kein `MutationObserver`. Die erste Ausführung installiert die globale API, weitere verwenden sie; Container werden über eine WeakMap und `data-fw-booking-state` höchstens einmal initialisiert. Ein schlanker API-Client mit fachlichen Fehlercodes gehört bereits zum Build; aus `@fw-booking/shared` werden nur Typen importiert, ein Build-Wächter erzwingt das.

### Begründung

Ein klassisches Script funktioniert ohne `type="module"` mit `wp_enqueue_script` und auf jeder Seite. Datenattribute machen jeden Container selbstbeschreibend, passend zu Shortcode und Block, und erlauben unterschiedliche Kalender auf einer Seite. Ein dauerhafter Beobachter auf der ganzen Seite wäre für die seltenen nachträglich eingefügten Container unverhältnismäßig; `scan()` genügt dafür. Nur Typ-Importe halten das Bundle bei rund 4 KB statt Zod und Temporal mitzuliefern; die API prüft ihre Antworten ohnehin selbst gegen die strikten Schemas.

## 2026-10-09 – Kursansicht im Widget

### Kontext

Besucher sollen Kurstermine mit freien Plätzen sehen und einen Termin wählen können; das Buchungsformular folgt erst in task-4-4. Die öffentliche API liefert Kurstermine je Angebot für höchstens 62 Tage pro Abfrage. Ein Widget-Container kann alle Angebote oder ein bestimmtes zeigen sollen.

### Entscheidung

Ohne weiteres Attribut zeigt der Container eine Angebotsliste, mit `data-fw-booking-service` direkt ein festes Angebot. Die Kursansicht lädt die nächsten 62 Tage und auf „Weitere Termine“ jeweils die folgenden 62 Tage; ein leerer Zeitraum beendet die Liste. Ausgebuchte Termine bleiben sichtbar, sind aber nicht wählbar. Eine Auswahl wird in der Instanz gehalten und als Ereignis `fw-booking:select` am Container gemeldet. Zeiten werden mit der Intl-Formatierung aus `@fw-booking/shared/format` dargestellt, die als einzige shared-Datei im Bundle freigegeben ist.

### Begründung

Die Angebotsliste genügt für die meisten Seiten mit einem Shortcode, das feste Angebot erlaubt Kursseiten je Angebot. Nachladen in API-großen Zeiträumen hält Anfragen klein und macht spätere Termine erreichbar, ohne Monatsnavigation. Sichtbare ausgebuchte Termine zeigen, dass der Kurs stattfindet. Das Ereignis entkoppelt die Ansicht vom späteren Formular und lässt einbindende Seiten reagieren. Ein leerer Zeitraum als Ende ist eine bewusste Vereinfachung: Lücken von mehr als 62 Tagen innerhalb des Buchungshorizonts beenden die Liste vorzeitig.

## 2026-10-09 – Slot-Auswahl für Einzeltermine im Widget

### Kontext

Für Einzeltermine berechnet die API freie Startzeiten im 5-Minuten-Raster; an einem langen Tag sind das rund 100 Zeiten. Besucher brauchen einen schnellen Weg zum ersten freien Termin und eine übersichtliche Uhrzeitwahl. Freie Tage liefert `available-dates` für höchstens 62 Tage je Abfrage.

### Entscheidung

Monatskalender (Tabelle Mo–So, höchstens 12 Monate voraus) mit wählbaren Tagen aus `available-dates`, eine Abfrage je Monat. Der erste freie Tag ist vorausgewählt, seine Uhrzeiten werden sofort geladen. Startzeiten werden nach Vormittag, Nachmittag und Abend gruppiert und zeigen nur den Beginn. Jeder Tageswechsel lädt die Slots neu und setzt eine gewählte Uhrzeit zurück; die Auswahl wird wie bei Kursen über `fw-booking:select` gemeldet (`type: 'single'`).

### Begründung

Ein Monatskalender ist die vertraute Darstellung und hält Abfragen klein. Die Vorauswahl spart einen Klick und zeigt sofort, wann der nächste Termin frei ist. Gruppen nach Tageszeit machen 100 Zeiten überblickbar, ohne die fachliche Regel (jede Startzeit buchbar) einzuschränken. Die Tabelle bleibt auch ohne Styling als Kalender lesbar. Die Suche nach dem ersten freien Monat kann bis zu 12 Abfragen auslösen, wenn lange nichts frei ist; das liegt deutlich unter der Lesegrenze von 120 Anfragen je Minute.

## 2026-10-09 – Buchungsformular im Widget

### Kontext

Besucher sollen beide Terminarten über das Widget verbindlich buchen. Doppelklicks dürfen keine zweite Buchung erzeugen, zwischenzeitlich vergebene Termine brauchen eine verständliche Meldung. Die Bestätigung der Datenschutzhinweise ist Pflicht und muss auf die Hinweise der einbindenden Website verweisen.

### Entscheidung

Nach der Terminwahl führt „Weiter zu deinen Angaben“ in einen eigenen Schritt; die Auswahlansicht bleibt erhalten und ist über „Termin ändern“ erreichbar. Die Datenschutzadresse ist ein Pflicht-Attribut des Containers (`data-fw-booking-privacy-url`), ohne sie gilt die Einbindung als fehlerhaft. Während einer Anfrage ist das Absenden gesperrt; derselbe Termin mit denselben Angaben behält seinen Idempotenzschlüssel, Änderungen erzeugen einen neuen. Vergebene oder nicht mehr buchbare Termine führen mit Hinweis zurück zur Auswahl, die am Browser-Cache vorbei neu geladen wird; die Eingaben bleiben erhalten, die Datenschutz-Checkbox wird je Buchung neu bestätigt. Nach Erfolg folgen eine Bestätigungsansicht und das Ereignis `fw-booking:booked` ohne Teilnehmerdaten.

### Begründung

Ein eigener Schritt bleibt bei rund 100 Uhrzeiten und auf dem Handy übersichtlich. Das Pflicht-Attribut verhindert Einbindungen ohne erreichbare Datenschutzhinweise; das WordPress-Plugin kann die Datenschutzseite von WordPress vorbelegen. Gesperrtes Absenden plus stabiler Schlüssel schützt sowohl vor Doppelklicks als auch vor doppelten Buchungen bei verlorenen Antworten. Ohne Umgehung des Caches zeigte die Auswahl nach einem Konflikt bis zu 30 Sekunden lang die alte Verfügbarkeit (im Browser beobachtet). Die erneute Bestätigung der Checkbox hält die Einwilligung an die einzelne Buchung gebunden.

## 2026-10-09 – CSS-Schnittstelle und Tastaturbedienung des Widgets

### Kontext

Das Widget läuft im Light DOM beliebiger WordPress-Themes. Es muss ohne Anpassung ordentlich aussehen, sich gegen typische globale Theme-Regeln (Buttons, Listen, Tabellen, Überschriften) behaupten, aber leicht an die Marke der Website anpassbar sein. Außerdem muss es vollständig per Tastatur bedienbar sein.

### Entscheidung

Eigene Datei `fw-booking-widget.css` neben dem Script, ausgeliefert über `<link>` bzw. `wp_enqueue_style`. Alle Regeln unter `.fw-booking-root`; ein gezielter Reset mit `:where()` neutralisiert Theme-Styles für Buttons, Felder, Listen, Tabellen und Überschriften innerhalb des Widgets. Schrift und Textfarbe erben vom Theme, eine Akzentfarbe und neutrale halbtransparente Flächen funktionieren auf hellen wie dunklen Seiten; Anpassungen und Dunkelmodus laufen ausschließlich über Custom Properties `--fw-booking-*`. Monatskalender und Uhrzeiten haben jeweils einen Tab-Stopp mit Pfeiltasten (roving tabindex).

### Begründung

Eine separate Datei ist cachebar und funktioniert mit strikter Content-Security-Policy, die Inline-Styles blockieren würde. `:where()` hält die Spezifität des Resets niedrig, sodass eigene Regeln mit einer Klasse gewinnen, während Element-Selektoren der Themes verlieren (im Browser gegen ein simuliertes Theme geprüft). Ein automatischer Dunkelmodus hätte auf hellen Themes mit dunklem Systemmodus falsch gewirkt. Die Pfeiltasten für Uhrzeiten waren ursprünglich nicht geplant (Tab-Reihenfolge); die Browser-Prüfung zeigte rund 100 Tab-Stopps bis „Weiter“, daher dasselbe Muster wie im Kalender.

## 2026-10-09 – Self-Service-Seite im Widget

### Kontext

Mails verlinken `MANAGE_PAGE_URL#t=TOKEN`, eine Seite mit dem Widget. Teilnehmer sollen dort ihre Buchung ansehen, stornieren und umbuchen. Das Token ist ein Zugangsschlüssel zur Buchung und darf weder in Referrer, Analytics, Server-Logs noch im Verlauf auftauchen. Für Einzeltermine gab es keine Übersicht der möglichen Tage beim Umbuchen.

### Entscheidung

Das Script liest das Token beim Ausführen, entfernt das Fragment sofort per `history.replaceState` und hält das Token nur im Arbeitsspeicher; nach dem Neuladen muss der Link erneut geöffnet werden. Die Verwaltung erscheint im Container mit `data-fw-booking-manage`, sonst im ersten Container. Storno und Umbuchung erfordern einen eigenen Bestätigungsschritt. Neuer Endpunkt `GET /api/public/manage/available-dates` (eigene Zeit gilt als frei, eigener Beginn zählt nicht) für den Monatskalender bei der Umbuchung; die Auswahlansichten aus task-4-2/4-3 werden mit einem Verwaltungs-Reader wiederverwendet.

### Begründung

Fragmente werden nie an Server oder im Referrer übertragen; nach dem Entfernen können auch später ausgeführte Scripts die Adresse nicht mehr mit Token lesen. Ohne Speicherung im Browser bleibt kein Token zurück, das andere Scripts der Seite später finden könnten. Der markierte Container erlaubt Seiten mit mehreren Kalendern, der erste Container als Rückfall hält die Einbindung einfach. Der eigene Endpunkt liefert dieselben Tage, die manage/slots anbietet; der öffentliche Endpunkt hätte Tage ausgelassen, an denen nur die eigene Zeit frei wäre. Damit das Token auch vor Analytics-Scripts entfernt wird, soll das Script auf der Verwaltungsseite früh im `<head>` geladen werden (WordPress-Plugin, task-4-7).

## 2026-10-09 – WordPress-Plugin

### Kontext

Kunden binden das Widget auf ihrer WordPress-Seite ein. Das Plugin soll nur ein Integrationsadapter sein: keine Buchungslogik, keine Zugangsdaten, Assets nur einmal laden, und auf der Verwaltungsseite muss das Widget-Script vor Analytics laufen, damit das Token aus dem Link entfernt ist. PHP war lokal nicht installiert.

### Entscheidung

Plugin `fw-booking` mit Shortcode und dynamischem Block (`block.json`, Editor-Script in reinem JavaScript ohne Build, gemeinsame serverseitige Ausgabe). Einstellungen speichern nur API-Adresse, Kalenderkennung und Seiten-IDs; ungültige Eingaben werden mit Meldung abgelehnt, der alte Wert bleibt. Die Widget-Dateien werden ins Plugin kopiert und von der eigenen Domain ausgeliefert; geladen werden sie nur auf Seiten mit Widget, im `<head>`, auf der Verwaltungsseite mit Priorität 1 vor allen anderen Scripts. Die Verwaltungsseite wird als Einstellung gewählt. Lokal läuft WordPress per Docker (`infra/docker-compose.wordpress.yml`, WP-CLI für Einrichtung und Tests).

### Begründung

Ohne Build-Schritt bleibt das Plugin klein und ohne zusätzliche Toolchain wartbar. Eigene Assets funktionieren mit strikter Content-Security-Policy und ohne Zugriff auf weitere Server; Updates des Widgets kommen mit dem Plugin. Die Ausgabe in `wp_head` mit Priorität 1 ist der früheste Zeitpunkt, den ein Plugin zuverlässig erreicht. Docker entspricht echten Installationen (Apache, PHP, MariaDB) und braucht kein lokales PHP. Im Test fiel auf, dass `esc_url_raw` unzulässige Adressen stillschweigend leert; das gilt jetzt als Fehler statt als geleertes Feld.


## 2026-10-09 – Portal-Gerüst und Anmeldung

### Kontext

Owner sollen Angebote, Öffnungszeiten, Kurstermine, Buchungen und Benachrichtigungsfehler in einem eigenen Portal pflegen, das später als PWA installiert wird. Die Owner-API arbeitet mit einem HttpOnly-Sitzungs-Cookie (`SameSite=Lax`) und einem CSRF-Token je Sitzung; Owner-Routen haben bewusst keine CORS-Freigabe. Zugangstoken dürfen nicht im JavaScript-Speicher liegen.

### Entscheidung

React-Portal mit Vite und TypeScript in `apps/portal`, Routing mit React Router (Datenrouter, `createBrowserRouter`), Serverdaten mit TanStack Query, eigenes CSS mit Custom Properties (mobil zuerst, heller und dunkler Modus nach Systemeinstellung). Portal und API laufen unter derselben Origin: lokal leitet der Vite-Dev-Server `/api` an die API weiter (`PORTAL_API_TARGET`, Standard `http://127.0.0.1:3000`), in Produktion liefert derselbe Host Portal und `/api` aus (Festlegung der Auslieferung in task-7-4). Der API-Client sendet nur relative `/api/…`-Pfade mit `credentials: 'same-origin'`, `cache: 'no-store'` und ohne Referrer; ändernde Anfragen immer als JSON mit `X-CSRF-Token`. Owner und CSRF-Token stehen nur im Query-Cache im Arbeitsspeicher und werden nach dem Neuladen über `GET /api/auth/session` geholt. Jede Owner-Anfrage mit 401 beendet die Sitzung im Portal und leert alle Owner-Daten aus dem Cache; geschützte Seiten leiten dann zum Login und kehren nach der Anmeldung zur ursprünglichen Seite zurück (nur Pfade innerhalb des Portals). Logout wiederholt einen 403 (veraltetes CSRF-Token) einmal mit neu gelesener Sitzung. ESLint prüft das Portal zusätzlich mit `eslint-plugin-react-hooks`.

### Begründung

Gleiche Origin vermeidet CORS mit Credentials und Cookie-Ausnahmen; das `SameSite=Lax`-Cookie und der CSRF-Schutz der API funktionieren unverändert. Ein Token, das JavaScript nie sieht, kann auch kein eingeschleustes Script auslesen; das CSRF-Token allein erlaubt ohne Cookie keine Anfrage. React Router und TanStack Query sind verbreitet und decken geschützte Routen, Neuladen und Mutationen der folgenden Verwaltungsseiten ab, ohne eigene Infrastruktur. Eigenes CSS hält das Bundle klein und passt zur späteren PWA. Das Leeren des Caches bei Sitzungsende verhindert, dass Teilnehmerdaten eines Owners nach dem Abmelden im Speicher bleiben.
