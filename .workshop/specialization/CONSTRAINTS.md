# Technische Rahmenbedingungen

- Die API ist die einzige Instanz, die verbindlich über Buchungen entscheidet. Browser, Widget und WordPress erhalten niemals MongoDB-Zugangsdaten.
- Buchung, Storno und Umbuchung erfolgen serverseitig in MongoDB-Transaktionen; jede Buchungsanfrage trägt einen Idempotenzschlüssel.
- Einzeltermine sperren die Ressource über Belegungseinheiten mit eindeutigem Index; Kurse prüfen die Kapazität atomar in der Schreibbedingung.
- Zeitpunkte werden in UTC gespeichert, Wiederholungen in der Zeitzone des Owners berechnet.
- Öffentliche API-Antworten enthalten keine personenbezogenen Daten.
- Widget im Light DOM ohne iframe, alle Klassen mit Präfix `fw-booking-`, kein ungeprüftes HTML aus Daten.
- Owner-Authentifizierung über serverseitige Sessions mit Secure/HttpOnly-Cookies und CSRF-Schutz; keine Tokens im JavaScript-Speicher.
- Service Worker cacht nur statische Assets, keine Teilnehmerdaten.
- Secrets nie im Repository, in Logs oder in Browser-Antworten.
- Eine Ressource je Installation, ein Platz pro Buchung (siehe `docs/decisions.md`).
- Parallele `in_progress`-Tasks sind nicht erlaubt.

Diese Rahmenbedingungen ergänzen den zentralen Workshop-Workflow und dürfen ihn nicht überschreiben.
