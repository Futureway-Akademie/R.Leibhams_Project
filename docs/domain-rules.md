# Fachregeln

Verbindliche fachliche Regeln für WP Buchung Kalender plus PWA. Sie gelten für API, Worker, Widget und Portal gleichermaßen; maßgeblich durchgesetzt werden sie ausschließlich serverseitig in der API. Werte mit „Standard“ sind Voreinstellungen je Installation und können je Angebot überschrieben werden.

## 1. Begriffe

| Begriff | Bedeutung |
|---|---|
| **Installation** | Eine Kundeninstanz mit eigener Datenbank, eigenem Owner-Zugang und einer Zeitzone. |
| **Owner** | Betreiber der Installation (z. B. Friseur, Yogastudio), verwaltet Angebote und Termine. |
| **Interessent / Teilnehmer** | Person, die über das Widget bucht. Hat kein Benutzerkonto. |
| **Angebot** | Buchbare Leistung mit genau einer Terminart, z. B. „Herrenhaarschnitt“ oder „Yoga für Einsteiger“. |
| **Terminart** | `einzeltermin` oder `gruppenkurs`. Nach dem Anlegen unveränderlich. |
| **Ressource** | Das, was belegt wird (in der ersten Version: genau eine je Installation, typischerweise der Owner selbst). |
| **Slot** | Berechneter, buchbarer Startzeitpunkt eines Einzeltermins. Wird nicht vorab gespeichert. |
| **Kurstermin** | Konkret gespeicherter Termin eines Gruppenkurses mit Beginn, Ende und Kapazität. |
| **Buchung** | Verbindliche Reservierung genau eines Platzes für genau eine Person. |
| **Belegungseinheit** | Technische Zeiteinheit (5 Minuten) der Ressource. Jede belegte Einheit existiert höchstens einmal; so werden Überschneidungen datenbankseitig ausgeschlossen. |

## 2. Einzeltermin

### 2.1 Angebotsparameter

| Parameter | Regel |
|---|---|
| Dauer | Pflicht, Vielfaches von 5 Minuten, 5–480 Minuten. Enthält einen eventuellen Puffer bereits; es gibt **keinen eigenen Puffer**. |
| Kapazität | Immer 1, nicht änderbar. |

### 2.2 Öffnungszeiten und Ausnahmen

- Öffnungszeiten werden je Wochentag als ein oder mehrere Zeitfenster in lokaler Zeit gepflegt (z. B. Mo 09:00–12:00 und 13:00–18:00).
- Zeitfenster eines Tages dürfen sich nicht überschneiden.
- Beginn und Ende liegen auf dem 5-Minuten-Raster (z. B. 09:05, nicht 09:07). `24:00` bezeichnet Mitternacht am Ende des Tages.
- Der Wochenplan wird immer als Ganzes gespeichert; nicht aufgeführte Wochentage sind geschlossen.
- **Ausnahmen** haben Vorrang vor Öffnungszeiten:
  - *Sperrzeit* (z. B. Urlaub, Arzttermin): Zeitraum ist nicht buchbar.
  - *Zusätzliche Öffnung*: Zeitraum ist zusätzlich buchbar.
  - Überschneiden sich Sperrzeit und zusätzliche Öffnung, **gewinnt die Sperrzeit**.
  - Ausnahmen liegen ebenfalls auf dem 5-Minuten-Raster. Sie werden angelegt oder gelöscht, nicht bearbeitet.
- Ausnahmen, die bereits gebuchte Termine überdecken, sind zulässig, sagen diese aber **nicht** automatisch ab. Das Portal zeigt die betroffenen Buchungen als Konflikt an; der Owner entscheidet über eine Absage (siehe 7).

### 2.3 Slot-Berechnung

Ein Slot mit Beginn `S` ist buchbar, wenn alle Bedingungen gelten:

1. `S` liegt im **5-Minuten-Raster**, gezählt ab Beginn des jeweiligen Öffnungsfensters. Es wird jede Startzeit angeboten, die passt; der Kalender optimiert die Tagesplanung nicht. Beispiel: Bartrasur (20 Minuten), freie Stunde 12–13 Uhr → 12:00, 12:05, … 12:40.
2. `S` bis `S + Dauer` liegt vollständig in einem geöffneten Zeitfenster.
3. `S` bis `S + Dauer` überschneidet sich nicht mit belegten Zeiten der Ressource (Einzeltermine und Kurstermine, siehe 4).
4. `S` ≥ jetzt + Mindestvorlauf.
5. `S` ≤ jetzt + Buchungshorizont.

Das Raster läuft in **lokaler Zeit** (Wanduhr). Am Tag der Sommerzeitumstellung entfallen Kandidaten in der übersprungenen Stunde; am Tag der Winterzeitumstellung gilt das erste Vorkommen, sodass keine Uhrzeit doppelt angeboten wird. Mindestvorlauf und Horizont stammen aus dem Angebot, sonst aus den Standardwerten der Installation.

Die angezeigte Slot-Liste ist unverbindlich. Verbindlich ist nur die atomare Prüfung beim Buchen.

Öffentlich werden bei Einzelterminen nur freie Slots angezeigt; vergebene Zeiten erscheinen nicht.

## 3. Gruppenkurs

### 3.1 Angebotsparameter

| Parameter | Regel |
|---|---|
| Dauer | Pflicht, Vielfaches von 5 Minuten. |
| Standardkapazität | Ganzzahl ≥ 2. Wird bei neuen Kursterminen übernommen. |

### 3.2 Kurstermine

- Kurstermine werden einzeln angelegt oder über **wiederkehrende Regeln** erzeugt (Wochentage, lokale Startzeit, Gültigkeitszeitraum).
- Die Erzeugung erfolgt innerhalb des Buchungshorizonts und ist idempotent: Je Regel und lokalem Startzeitpunkt existiert höchstens ein Kurstermin.
- Startzeiten liegen auf dem 5-Minuten-Raster. In **Sperrzeiten** (z. B. Urlaub) werden keine Kurstermine aus Regeln erzeugt; einzelne Kurstermine kann der Owner dort bewusst anlegen.
- Überschneidet sich ein zu erzeugender Termin mit belegter Zeit, wird er übersprungen und als Konflikt gemeldet.
- Die Erzeugung läuft beim Anlegen oder Ändern einer Regel, beim API-Start und danach alle 6 Stunden, damit der Horizont nachwandert. Deaktivierte Angebote erzeugen keine neuen Termine.
- Ein einzelner Kurstermin kann abweichende Kapazität, Uhrzeit oder Ort erhalten, ohne die Regel zu ändern. Die **Uhrzeit** ist nur änderbar, solange es für den Termin keine Buchungen gibt; sonst wird abgesagt und neu angelegt.
- Ein Kurstermin darf sich nicht mit anderen Kursterminen oder gebuchten Einzelterminen derselben Ressource überschneiden; die Anlage wird sonst abgelehnt.

### 3.3 Änderung wiederkehrender Regeln

- Änderungen wirken nur auf **zukünftige Kurstermine ohne Buchungshistorie**; diese werden neu erzeugt bzw. entfernt.
- Kurstermine mit Buchungen (auch stornierten) bleiben unverändert. Die Antwort nennt sie als Hinweis.
- Wird eine Regel gelöscht, entfallen ihre künftigen Termine ohne Buchungshistorie; gebuchte bleiben bestehen.

### 3.4 Kapazität

- Freie Plätze = Kapazität − aktive Buchungen.
- Öffentlich erscheinen geplante Kurstermine innerhalb von Mindestvorlauf und Horizont, **auch ausgebuchte** (mit 0 freien Plätzen). Gesperrte und abgesagte Termine erscheinen nicht.
- Die Kapazität kann erhöht werden.
- Eine Senkung **unter die Zahl aktiver Buchungen** wird abgelehnt.

## 4. Gemeinsame Ressource

- Einzeltermine und Kurse einer Installation teilen sich die Ressource.
- Ein Einzeltermin belegt die Ressource von `Beginn` bis `Ende` (genau seine Dauer).
- Ein Kurstermin belegt die Ressource von `Beginn` bis `Ende`, unabhängig von der Zahl der Buchungen – bereits ab seiner Anlage.
- Gesperrte Kurstermine belegen die Ressource weiterhin; abgesagte geben sie frei.
- Die Belegung wird in Belegungseinheiten zu 5 Minuten gespeichert. Ein eindeutiger Index auf (Ressource, Einheit) verhindert Überschneidungen auch bei gleichzeitigen Anfragen.

## 5. Buchung

### 5.1 Pflichtangaben

| Feld | Regel |
|---|---|
| Name | Pflicht, 2–100 Zeichen. |
| E-Mail | Pflicht, syntaktisch gültige Adresse. |
| Telefon | **Pflicht**, 6–20 Zeichen, Ziffern, Leerzeichen und `+ - / ( )`. |

| Datenschutzhinweise | **Pflicht-Checkbox**: Die Buchung ist nur mit ausdrücklicher Bestätigung möglich; der Zeitpunkt wird mit der Buchung gespeichert. |

Die Telefonnummer dient ausschließlich kurzfristigen Rückfragen zum Termin. Dieser Zweck muss in den Datenschutzhinweisen des jeweiligen Kunden genannt werden. Teilnehmerdaten erscheinen nie in öffentlichen API-Antworten.

### 5.2 Verbindlichkeit

- Eine Buchung ist **sofort verbindlich** (Status `bestätigt`). Es gibt keine Freigabe durch den Owner.
- Eine Buchung umfasst genau einen Platz und eine Person.

### 5.3 Fristen

| Frist | Standard | Bedeutung |
|---|---|---|
| Mindestvorlauf | **24 Stunden** | Frühester buchbarer Beginn = jetzt + Mindestvorlauf. |
| Buchungshorizont | **90 Tage** | Spätester buchbarer Beginn = jetzt + Horizont. |
| Storno-/Umbuchungsfrist | **24 Stunden** | Online-Änderungen sind bis 24 Stunden vor Beginn möglich. |

Alle drei Werte sind je Angebot überschreibbar und werden serverseitig zum Zeitpunkt der Anfrage geprüft.

### 5.4 Ablauf und Konflikte

- Jede Buchungsanfrage trägt einen vom Client erzeugten **Idempotenzschlüssel**. Eine Wiederholung mit gleichem Schlüssel liefert die bestehende Buchung, keine neue.
- Buchung, Platz- bzw. Ressourcenbelegung, Action-Token und Benachrichtigungsauftrag entstehen gemeinsam in einer Transaktion oder gar nicht.
- Ist der Slot bzw. Kursplatz inzwischen vergeben, lautet das Ergebnis „Termin inzwischen vergeben“; es entsteht keine Buchung.
- Dieselbe E-Mail-Adresse darf denselben Kurstermin nur einmal aktiv buchen.
- Fehlschläge liefern einen fachlichen Code für das Widget: `session_full` (Kurs voll), `slot_taken` (Einzeltermin vergeben), `not_bookable` (gesperrt, abgesagt, außerhalb von Mindestvorlauf oder Horizont), `already_booked` (E-Mail hat den Kurstermin bereits aktiv gebucht), `idempotency_conflict` (gleicher Schlüssel mit anderen Daten).
- Die Bestätigungsantwort enthält keinen Verwaltungslink; dieser wird ausschließlich per E-Mail versendet.

### 5.5 Buchungsstatus

| Status | Bedeutung |
|---|---|
| `bestätigt` (`confirmed`) | Aktive Buchung, belegt Platz bzw. Ressource. |
| `storniert` (`cancelled`) | Vom Teilnehmer storniert. |
| `umgebucht` (`rebooked`) | Durch Umbuchung ersetzt; verweist auf die neue Buchung. |
| `vom Owner abgesagt` (`cancelled_by_owner`) | Termin wurde vom Owner abgesagt. |

Nur `bestätigt` ist aktiv. Jeder Übergang aus `bestätigt` erfolgt genau einmal und gibt die Belegung genau einmal frei.

## 6. Storno und Umbuchung durch Teilnehmer

- Die Bestätigungsmail enthält einen Verwaltungslink mit zufälligem Token. Gespeichert wird nur dessen Hash.
- Der Token ist bis zum Terminende gültig und wird bei Storno, Umbuchung oder Owner-Absage für diese Buchung ungültig; eine Umbuchung erzeugt einen neuen Token.
- Das Öffnen des Links zeigt nur die Buchung an. Storno und Umbuchung erfordern eine **bewusste Bestätigung** auf der Seite.
- **Storno:** bis 24 Stunden (Standard) vor Beginn. Die Belegung wird sofort freigegeben.
- **Umbuchung:**
  - nur auf einen anderen Termin **desselben Angebots**;
  - bis 24 Stunden (Standard) vor Beginn des **ursprünglichen** Termins;
  - der neue Termin muss die Regeln einer Neubuchung erfüllen (Mindestvorlauf, Horizont, Verfügbarkeit);
  - neuer Termin wird reserviert und alter freigegeben in derselben Transaktion; ist der neue Termin nicht verfügbar, bleibt die ursprüngliche Buchung unverändert.
- **Nach Ablauf der Frist** ist keine Online-Änderung mehr möglich. Die Self-Service-Seite zeigt die Kontaktdaten des Owners.

## 7. Owner-Aktionen

| Aktion | Regel |
|---|---|
| Kurstermin sperren | Keine neuen Buchungen; bestehende Buchungen bleiben gültig; Ressource bleibt belegt. Wieder entsperrbar. |
| Termin absagen | Jederzeit möglich, mit Bestätigungsdialog. Alle aktiven Buchungen erhalten Status „vom Owner abgesagt“, jeder Teilnehmer bekommt eine Absagemail. Nicht umkehrbar. |
| Einzelne Buchung absagen | Wie Termin absagen, aber nur für diese Buchung. |
| Löschen | Nur für Kurstermine ohne Buchungshistorie. Manuell angelegte werden gelöscht, aus Regeln erzeugte als abgesagt markiert (damit sie nicht neu entstehen). Termine mit Buchungen werden abgesagt, nicht gelöscht. |
| Terminart ändern | Nicht möglich. Für eine andere Terminart wird ein neues Angebot angelegt und das alte deaktiviert. |
| Angebot deaktivieren | Keine neuen Buchungen, nicht im Widget sichtbar; bestehende Buchungen bleiben gültig. Jederzeit reaktivierbar. Angebote werden nicht gelöscht. |
| Angebot ändern | Dauer, Kapazität und Fristen wirken nur auf künftige Slots und Kurstermine; bestehende Buchungen und Kurstermine bleiben unverändert. |
| Reihenfolge der Angebote | Manuell festgelegt; neue Angebote stehen am Ende. |

Alle Owner-Änderungen an Terminen und Buchungen werden in `auditEvents` protokolliert.

## 8. Zeitzonen

- Jede Installation hat genau eine Zeitzone. Standard: `Europe/Berlin`. Sie wird bei der Einrichtung festgelegt und ist für den Owner nur lesbar.
- Öffnungszeiten, Ausnahmen und wiederkehrende Regeln werden in **lokaler Zeit** gespeichert und interpretiert.
- Konkrete Zeitpunkte (Kurstermine, Buchungen, Belegungen) werden in **UTC** gespeichert, zusammen mit der Zeitzone.
- Anzeige in Widget, Portal, PWA und E-Mails erfolgt immer in der Zeitzone der Installation, mit Zeitzonenhinweis, wenn das Gerät eine andere verwendet.
- **Zeitumstellung:**
  - *Übersprungene Stunde* (Frühjahr, z. B. 02:00–03:00): Slots und Kurstermine, deren lokaler Beginn in diese Lücke fällt, entfallen.
  - *Doppelte Stunde* (Herbst, z. B. 02:00–03:00): Es gilt das **erste** Vorkommen.
  - *Grenzen von Öffnungszeiten und Ausnahmen* in der übersprungenen Stunde gelten ab dem Umstellungszeitpunkt (z. B. „02:30–05:00“ am Tag der Sommerzeitumstellung öffnet um 03:00).
  - Dauern sind reale Minuten; ein Termin über die Umstellung hinweg dauert so lange wie angegeben.

## 9. Benachrichtigungen

| Anlass | Empfänger | Zeitpunkt |
|---|---|---|
| Buchung | Teilnehmer | Sofort nach erfolgreicher Buchung, mit Verwaltungslink. |
| Erinnerung | Teilnehmer | **24 Stunden** vor Beginn. Entfällt, wenn die Buchung erst innerhalb dieses Fensters entsteht. Vor Versand wird geprüft, dass die Buchung noch `bestätigt` ist und der Termin unverändert. |
| Storno | Teilnehmer | Sofort nach Storno. |
| Umbuchung | Teilnehmer | Sofort, mit neuem Verwaltungslink. |
| Owner-Absage | Alle betroffenen Teilnehmer | Sofort nach Absage. |

- Benachrichtigungen werden über die Outbox versendet. Ein Versandfehler macht keine Buchung rückgängig.
- Endgültig fehlgeschlagene Benachrichtigungen sind für den Owner im Portal sichtbar.

## 10. Bezeichner im Code

Fachbegriffe stehen in Dokumentation und Oberfläche auf Deutsch, im Code auf Englisch. Die Schemas liegen in `packages/shared`.

| Fachbegriff | Code |
|---|---|
| Angebot | `service` |
| Terminart Einzeltermin / Gruppenkurs | `type: 'single'` / `type: 'group'` |
| Kurstermin | `session` |
| Wiederkehrende Kursregel | `courseRule` |
| Öffnungszeiten | `openingHours` |
| Ausnahme: Sperrzeit / zusätzliche Öffnung | `availabilityException`, `kind: 'closed'` / `'extra_opening'` |
| Buchung / Teilnehmer | `booking` / `participant` |
| Status bestätigt / storniert / umgebucht / vom Owner abgesagt | `confirmed` / `cancelled` / `rebooked` / `cancelled_by_owner` |
| Kurstermin geplant / gesperrt / abgesagt | `scheduled` / `blocked` / `cancelled` |
| Mindestvorlauf / Buchungshorizont / Storno- und Umbuchungsfrist | `minLeadMinutes` / `horizonDays` / `changeDeadlineMinutes` |

IDs sind MongoDB-ObjectIds als 24-stellige Hex-Strings. Zeitpunkte werden in der API als ISO-8601 in UTC (`…Z`) übertragen, die Zeitzone der Installation separat als `timeZone`. Lokale Angaben (Öffnungszeiten, Ausnahmen, Kursregeln) verwenden `HH:MM`, `YYYY-MM-DD` bzw. `YYYY-MM-DDTHH:MM` ohne Zeitzone.

## 11. Nicht in der ersten Version

Owner-Freigabe von Buchungen, mehrere Ressourcen, Sammelbuchungen, Wartelisten, Zahlungen, Teilnehmerkonten.
