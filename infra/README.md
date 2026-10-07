# Lokale Infrastruktur

Nur für die Entwicklung. Startet MongoDB 8.0 als Single-Node-Replica-Set (`rs0`, für Transaktionen erforderlich) und Mailpit als lokalen SMTP-Empfänger. Alle Ports sind ausschließlich an `127.0.0.1` gebunden; MongoDB läuft lokal ohne Authentifizierung.

Voraussetzung: Docker Desktop (bzw. Docker Engine mit Compose v2).

| Befehl (im Repository-Root) | Wirkung |
|---|---|
| `pnpm infra:up` | Container starten und warten, bis MongoDB bereit ist |
| `pnpm infra:verify` | Replica Set, Transaktion und Mailempfang prüfen |
| `pnpm infra:logs` | Logs verfolgen |
| `pnpm infra:down` | Container stoppen, Daten bleiben im Volume erhalten |
| `pnpm infra:reset` | Container stoppen und **alle lokalen Daten löschen** |

| Dienst | Adresse |
|---|---|
| MongoDB | `mongodb://localhost:27017/fw_booking?replicaSet=rs0` |
| SMTP (Mailpit) | `127.0.0.1:1025` |
| Mailpit-Oberfläche | http://127.0.0.1:8025 |

Die Verbindungswerte stehen auch in `.env.example`.
