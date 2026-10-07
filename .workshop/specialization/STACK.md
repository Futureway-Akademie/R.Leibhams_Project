# Technischer Stack

| Bereich | Technologie |
|---|---|
| Monorepo | pnpm-Workspaces, TypeScript, ESLint, Prettier |
| API | Node.js, NestJS, TypeScript (`apps/api`) |
| Hintergrund-Worker | Node.js, TypeScript, MongoDB-Outbox mit Job-Leases (`apps/worker`) |
| Verwaltungsportal/PWA | React, Vite, TypeScript (`apps/portal`) |
| Öffentliches Widget | TypeScript, eigener schlanker Vite-Library-Build, Light DOM (`packages/widget`) |
| Gemeinsame Typen | TypeScript, Validierungsschemas (`packages/shared`) |
| WordPress-Anbindung | PHP-Plugin mit Shortcode und Block (`plugins/wordpress`) |
| Datenbank | MongoDB als Replica Set (Transaktionen) |
| Lokale Infrastruktur | docker-compose mit MongoDB und Mailpit |
| Tests | Vitest bzw. Jest; Integrationstests gegen echtes Replica Set (z. B. mongodb-memory-server) |
| E-Mail | SMTP bzw. Versand-API, lokal Mailpit |

Der technische Stack ergänzt den zentralen Workshop-Workflow und darf ihn nicht überschreiben.
