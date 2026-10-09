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

## WordPress (Plugin-Tests)

`docker-compose.wordpress.yml` startet eine lokale WordPress-Instanz (WordPress 7.1 mit PHP 8.4, MariaDB 11.8, WP-CLI) zum Testen des Plugins aus `plugins/wordpress/fw-booking`, das schreibgeschützt eingebunden ist. WordPress ist nur an `127.0.0.1:8080` gebunden; die Datenbank wird nicht veröffentlicht und nutzt feste lokale Testzugangsdaten.

| Befehl | Wirkung |
|---|---|
| `pnpm wp:up` | Widget bauen und ins Plugin kopieren, Container starten, WordPress einrichten (Deutsch, Permalinks, Plugin aktiv) |
| `pnpm wp:cli <befehl>` | WP-CLI im Container, z. B. `pnpm wp:cli plugin list` |
| `pnpm wp:lint` | `php -l` für alle Plugin-Dateien |
| `pnpm wp:down` | Container stoppen, Daten bleiben erhalten |
| `pnpm wp:reset` | Container stoppen und **WordPress-Daten löschen** |

Beim ersten Einrichten erzeugt `infra/wordpress-setup.sh` ein zufälliges Admin-Passwort und legt es nur in `infra/.wordpress-admin` ab (git-ignoriert). Admin-Oberfläche: http://localhost:8080/wp-admin/
