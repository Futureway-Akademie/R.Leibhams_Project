// Baut den Service Worker als eigenständige Datei /sw.js und setzt die Liste der statischen
// App-Dateien ein (Build-Ausgabe plus public/). Nur diese Dateien landen im Cache des Browsers.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

export const SERVICE_WORKER_FILE = 'sw.js';
const SERVICE_WORKER_SOURCE = fileURLToPath(
  new URL('../src/sw/service-worker.ts', import.meta.url),
);
const PLACEHOLDER = '__FW_PRECACHE__';

export interface StaticFile {
  /** Pfad relativ zum Ausgabeordner, z. B. `assets/index-abc123.js`. */
  fileName: string;
  content: string | Uint8Array;
}

/** Statische Dateien für den Cache: ohne den Service Worker selbst und ohne Source Maps. */
export function precacheFiles(files: readonly StaticFile[]): StaticFile[] {
  return files
    .filter((file) => file.fileName !== SERVICE_WORKER_FILE && !file.fileName.endsWith('.map'))
    .sort((a, b) => a.fileName.localeCompare(b.fileName));
}

/** Version des Caches: ändert sich, sobald sich eine Datei oder die Dateiliste ändert. */
export function precacheVersion(files: readonly StaticFile[]): string {
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file.fileName).update('\0').update(file.content).update('\0');
  }
  return hash.digest('hex').slice(0, 16);
}

function listPublicFiles(dir: string): StaticFile[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const path = join(entry.parentPath, entry.name);
      return { fileName: relative(dir, path).split(sep).join('/'), content: readFileSync(path) };
    });
}

export function serviceWorkerPlugin(): Plugin {
  let publicDir = '';
  return {
    name: 'fw-portal-service-worker',
    apply: 'build',
    configResolved(config) {
      if (config.base !== '/') {
        throw new Error('Der Service Worker des Portals setzt base "/" voraus');
      }
      publicDir = config.build.copyPublicDir ? config.publicDir : '';
    },
    buildStart() {
      this.emitFile({ type: 'chunk', id: SERVICE_WORKER_SOURCE, fileName: SERVICE_WORKER_FILE });
    },
    generateBundle: {
      // Nach dem HTML-Plugin, damit index.html bereits zur Ausgabe gehört.
      order: 'post',
      handler(_options, bundle) {
        const worker = bundle[SERVICE_WORKER_FILE];
        if (worker?.type !== 'chunk') {
          this.error(`${SERVICE_WORKER_FILE} fehlt in der Build-Ausgabe`);
        }
        // Ein Service Worker als klassisches Script darf nichts nachladen.
        if (worker.imports.length > 0 || worker.dynamicImports.length > 0) {
          this.error(`${SERVICE_WORKER_FILE} muss eigenständig sein, importiert aber Chunks`);
        }

        const output = Object.values(bundle).map((file) => ({
          fileName: file.fileName,
          content: file.type === 'chunk' ? file.code : file.source,
        }));
        const files = precacheFiles([...output, ...(publicDir ? listPublicFiles(publicDir) : [])]);
        const precache = {
          version: precacheVersion(files),
          urls: files.map((file) => `/${file.fileName}`),
        };

        const parts = worker.code.split(PLACEHOLDER);
        if (parts.length !== 2) {
          this.error(
            `Platzhalter ${PLACEHOLDER} muss genau einmal in ${SERVICE_WORKER_FILE} stehen`,
          );
        }
        // Die Source Map passt nach dem Ersetzen nicht mehr; der Service Worker kommt ohne aus.
        worker.code = parts
          .join(JSON.stringify(precache))
          .replace(/\n?\/\/# sourceMappingURL=\S+\s*$/, '\n');
        delete bundle['sw.js.map'];
      },
    },
  };
}
