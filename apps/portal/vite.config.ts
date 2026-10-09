// Owner-Portal: Vite + React. Portal und API laufen unter derselben Origin (Sitzungs-Cookie mit
// SameSite=Lax, keine CORS-Freigabe für Owner-Routen); lokal leitet der Dev-Server /api weiter.
import react from '@vitejs/plugin-react';
import { defaultClientConditions } from 'vite';
import { defineConfig } from 'vitest/config';

/** Ziel des Proxys im Dev-Server und in `vite preview`; Standard ist die lokale API. */
const apiTarget = process.env.PORTAL_API_TARGET ?? 'http://127.0.0.1:3000';
const proxy = { '/api': { target: apiTarget, changeOrigin: false } };

export default defineConfig({
  plugins: [react()],
  // Workspace-Pakete aus dem Quellcode bauen (Bedingung `development` der shared-Exports).
  resolve: { conditions: ['development', ...defaultClientConditions] },
  server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true, proxy },
  build: { target: 'es2022', sourcemap: true, emptyOutDir: true },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
});
