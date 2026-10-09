// Eigener schlanker Build des öffentlichen Widgets: eine IIFE-Datei ohne Laufzeitabhängigkeiten.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { defaultClientConditions } from 'vite';
import type { Plugin } from 'vite';

export const WIDGET_FILE_NAME = 'fw-booking-widget.js';

/** Obergrenze für das minifizierte Bundle; schützt vor versehentlich eingebundenen Bibliotheken. */
export const WIDGET_SIZE_LIMIT_BYTES = 50_000;

/**
 * Einzeln freigegebene Dateien aus @fw-booking/shared. Sie dürfen nur Intl nutzen und nichts
 * importieren; alles andere aus shared (Zod-Schemas, Temporal-Umrechnung) bleibt draußen, aus dem
 * Index sind nur Typ-Importe erlaubt.
 */
export const ALLOWED_SHARED_FILES = [
  fileURLToPath(new URL('../shared/src/time/format.ts', import.meta.url)),
];

/**
 * Bricht den Build ab, wenn Code außerhalb von packages/widget/src und den freigegebenen
 * shared-Dateien im Bundle landet (z. B. Portal, React, Zod, Temporal-Polyfill) oder das
 * Größenlimit überschritten wird.
 */
function bundleGuard(): Plugin {
  const widgetSrc = fileURLToPath(new URL('./src/', import.meta.url));
  const allowed = new Set(ALLOWED_SHARED_FILES);
  return {
    name: 'fw-booking-bundle-guard',
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue;
        const foreign = Object.keys(output.modules).filter(
          (id) => !id.startsWith('\0') && !id.startsWith(widgetSrc) && !allowed.has(id),
        );
        if (foreign.length > 0) {
          this.error(`Unerlaubte Module im Widget-Bundle: ${foreign.join(', ')}`);
        }
        const size = Buffer.byteLength(output.code);
        if (size > WIDGET_SIZE_LIMIT_BYTES) {
          this.error(
            `Widget-Bundle ist ${String(size)} Bytes groß (Limit ${String(WIDGET_SIZE_LIMIT_BYTES)})`,
          );
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [bundleGuard()],
  // Workspace-Pakete aus dem Quellcode bauen (Bedingung `development` der shared-Exports).
  resolve: { conditions: ['development', ...defaultClientConditions] },
  build: {
    target: 'es2020',
    sourcemap: true,
    emptyOutDir: true,
    lib: {
      entry: fileURLToPath(new URL('./src/main.ts', import.meta.url)),
      formats: ['iife'],
      name: 'FwBookingWidget',
      fileName: () => WIDGET_FILE_NAME,
    },
  },
  test: {
    environment: 'jsdom',
  },
});
