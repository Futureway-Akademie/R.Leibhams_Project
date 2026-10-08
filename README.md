# WP Buchung Kalender plus PWA

Eigenständige Buchungsanwendung für Einzeltermine und Gruppenkurse: API mit MongoDB, eingebettetes WordPress-Widget ohne iframe und ein Verwaltungsportal als installierbare PWA. Je Kunde eine getrennte Installation.

- Projektbrief: `.workshop/PROJECT_BRIEF.md`
- Architektur: `docs/architecture.md`
- Fachregeln: `docs/domain-rules.md`
- Entscheidungen: `docs/decisions.md`

## Entwicklung

Voraussetzungen: Node.js 24 (siehe `.nvmrc`), Docker Desktop und pnpm 12 (über Corepack, Version in `package.json` → `packageManager`).

```bash
corepack enable pnpm   # falls keine Schreibrechte: --install-directory <Verzeichnis im PATH>
pnpm install
cp .env.example .env
pnpm infra:up
pnpm --filter @fw-booking/api db:migrate   # Collections, Validatoren, Indizes
pnpm --filter @fw-booking/api owner:create --email du@example.de   # Passwort wird verdeckt abgefragt
pnpm --filter @fw-booking/api dev   # API auf http://127.0.0.1:3000, Healthcheck unter /health
pnpm --filter @fw-booking/worker dev   # Hintergrund-Worker (Outbox-Jobs)
```

| Befehl | Zweck |
|---|---|
| `pnpm build` | Pakete, API und Worker bauen (`dist/`) |
| `pnpm lint` | ESLint (typbasiert) über das gesamte Repository |
| `pnpm typecheck` | `tsc --noEmit` in allen Workspace-Paketen |
| `pnpm test` | Vitest in allen Workspace-Paketen |
| `pnpm format` / `pnpm format:check` | Prettier schreiben bzw. prüfen |
| `pnpm --filter @fw-booking/api test:concurrency` | Lastlauf der Nebenläufigkeitstests (200 parallele Anfragen × 20 Durchläufe, Log unter `apps/api/logs/`) |
| `pnpm infra:up` / `infra:down` / `infra:reset` / `infra:verify` | Lokale MongoDB und Mailpit (siehe `infra/README.md`) |

## Struktur

```
apps/api          Buchungs-API
apps/worker       Hintergrund-Worker (Outbox, E-Mail)
apps/portal       Owner-Portal und PWA
packages/db       Datenmodell, Collections und Migrationen
packages/shared   Domänentypen, Validierung, Zeitzonen
packages/widget   Öffentliches Buchungs-Widget
plugins/wordpress PHP-Plugin (nicht Teil des pnpm-Workspaces)
infra/            docker-compose für lokale MongoDB und Mailpit
```

## Für Coding-Agenten

- Codex: Lies zuerst `AGENTS.md`.
- Claude Code: Lies zuerst `CLAUDE.md`.
- Andere Coding-Agenten: Lies zuerst `.agents/generic/INSTRUCTIONS.md`.

Danach gelten für alle Agenten dieselben autoritativen Dateien unter `.workshop/`. Das Dashboard arbeitet mit dem synchronisierten Repository-Stand; lokale, noch nicht synchronisierte Änderungen sind dort nicht automatisch sichtbar.
