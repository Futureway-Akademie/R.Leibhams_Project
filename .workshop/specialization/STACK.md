# Technischer Stack

| Bereich | Technologie |
|---|---|
| Monorepo | pnpm 12 (Corepack) mit `pnpm -r`, TypeScript 6.0, ESLint 9 (typescript-eslint, typbasiert), Prettier 3 |
| API | NestJS 12 mit Express, offizieller MongoDB-Treiber 7, nestjs-pino; Build und Tests mit SWC (`apps/api`) |
| Hintergrund-Worker | Node.js, TypeScript, MongoDB-Outbox mit Job-Leases (`apps/worker`) |
| Verwaltungsportal/PWA | React, Vite, TypeScript (`apps/portal`) |
| Öffentliches Widget | TypeScript, eigener schlanker Vite-Library-Build, Light DOM (`packages/widget`) |
| Gemeinsame Typen | TypeScript, Validierungsschemas (`packages/shared`) |
| WordPress-Anbindung | PHP-Plugin mit Shortcode und Block (`plugins/wordpress`) |
| Laufzeit | Node.js 24 |
| Datenbank | MongoDB als Replica Set (Transaktionen) |
| Lokale Infrastruktur | docker-compose mit MongoDB und Mailpit |
| Tests | Vitest in allen Paketen; API-Integrationstests mit supertest gegen mongodb-memory-server (Replica Set, MongoDB 8.0.32) |
| E-Mail | SMTP bzw. Versand-API, lokal Mailpit |

Der technische Stack ergänzt den zentralen Workshop-Workflow und darf ihn nicht überschreiben.
