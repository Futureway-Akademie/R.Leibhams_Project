import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC statt esbuild, weil NestJS für Dependency Injection Decorator-Metadaten benötigt.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    testTimeout: 30_000,
    // Erster Lauf lädt ggf. die MongoDB-Binärdatei für mongodb-memory-server.
    hookTimeout: 300_000,
  },
});
