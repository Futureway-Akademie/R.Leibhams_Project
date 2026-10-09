// Eigener schlanker Build des öffentlichen Widgets: eine IIFE-Datei ohne Laufzeitabhängigkeiten.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';

export const WIDGET_FILE_NAME = 'fw-booking-widget.js';

/** Obergrenze für das minifizierte Bundle; schützt vor versehentlich eingebundenen Bibliotheken. */
export const WIDGET_SIZE_LIMIT_BYTES = 50_000;

/**
 * Bricht den Build ab, wenn Code außerhalb von packages/widget/src im Bundle landet (z. B. Portal,
 * React, Zod, Temporal-Polyfill) oder das Größenlimit überschritten wird. Aus @fw-booking/shared
 * sind nur Typ-Importe vorgesehen; sie erzeugen keine Module. Soll Laufzeitcode daraus ins Widget
 * (etwa die Intl-Formatierung), wird die einzelne Datei hier bewusst freigegeben.
 */
function bundleGuard(): Plugin {
  const widgetSrc = fileURLToPath(new URL('./src/', import.meta.url));
  return {
    name: 'fw-booking-bundle-guard',
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue;
        const foreign = Object.keys(output.modules).filter(
          (id) => !id.startsWith('\0') && !id.startsWith(widgetSrc),
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
