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
