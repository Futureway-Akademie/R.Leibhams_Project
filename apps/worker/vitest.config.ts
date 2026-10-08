import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 30_000,
    // Erster Lauf lädt ggf. die MongoDB-Binärdatei für mongodb-memory-server.
    hookTimeout: 300_000,
  },
});
