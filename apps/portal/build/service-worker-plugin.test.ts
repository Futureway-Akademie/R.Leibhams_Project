// @vitest-environment node
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { precacheFiles, precacheVersion, SERVICE_WORKER_FILE } from './service-worker-plugin.js';
import type { Precache } from '../src/sw/rules.js';

describe('precacheFiles', () => {
  it('nimmt Build-Dateien und public/ auf, aber nicht den Service Worker und keine Source Maps', () => {
    const files = precacheFiles([
      { fileName: 'index.html', content: '<html>' },
      { fileName: 'assets/index-abc.js', content: 'js' },
      { fileName: 'assets/index-abc.js.map', content: '{}' },
      { fileName: SERVICE_WORKER_FILE, content: 'sw' },
      { fileName: 'icons/icon-192.png', content: new Uint8Array([1, 2]) },
    ]);
    expect(files.map((file) => file.fileName)).toEqual([
      'assets/index-abc.js',
      'icons/icon-192.png',
      'index.html',
    ]);
  });
});

describe('precacheVersion', () => {
  const html = { fileName: 'index.html', content: '<html>' };
  const icon = { fileName: 'icons/icon.svg', content: new Uint8Array([1, 2, 3]) };
  const base = [html, icon];

  it('bleibt bei gleichem Inhalt gleich', () => {
    expect(precacheVersion(base)).toBe(precacheVersion(base.map((file) => ({ ...file }))));
  });

  it('ändert sich mit dem Inhalt einer Datei oder der Dateiliste', () => {
    const version = precacheVersion(base);
    expect(precacheVersion([html, { ...icon, content: new Uint8Array([1, 2, 4]) }])).not.toBe(
      version,
    );
    expect(precacheVersion([...base, { fileName: 'assets/a.js', content: '' }])).not.toBe(version);
  });
});

describe('Build des Portals', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  let outDir = '';

  beforeAll(async () => {
    outDir = mkdtempSync(join(tmpdir(), 'fw-portal-build-'));
    // Vitest setzt NODE_ENV=test; ohne Umstellen fiele die Registrierung (nur PROD) aus dem Bundle.
    const nodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await build({ root, logLevel: 'silent', build: { outDir, emptyOutDir: true } });
    } finally {
      process.env.NODE_ENV = nodeEnv;
    }
  }, 60_000);

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  function readPrecache(): { code: string; precache: Precache } {
    const code = readFileSync(join(outDir, SERVICE_WORKER_FILE), 'utf8');
    const match = /\{"version":"[0-9a-f]+","urls":\[[^\]]*\]\}/.exec(code);
    if (!match) throw new Error('Dateiliste fehlt in sw.js');
    return { code, precache: JSON.parse(match[0]) as Precache };
  }

  it('registriert den Service Worker im Portal-Bundle', () => {
    const assets = readdirSync(join(outDir, 'assets')).filter((name) => name.endsWith('.js'));
    const code = assets.map((name) => readFileSync(join(outDir, 'assets', name), 'utf8')).join('');
    expect(code).toContain('/sw.js');
  });

  it('erzeugt einen eigenständigen Service Worker ohne Imports und ohne Source Map', () => {
    const { code } = readPrecache();
    expect(code).not.toMatch(/\bimport\b/);
    expect(code).not.toContain('__FW_PRECACHE__');
    expect(code).not.toContain('sourceMappingURL');
    expect(readdirSync(outDir)).not.toContain(`${SERVICE_WORKER_FILE}.map`);
  });

  it('listet genau die statischen Dateien der Ausgabe, ohne API-Pfade', () => {
    const { precache } = readPrecache();
    const output = readdirSync(outDir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => `/${join(entry.parentPath, entry.name).slice(outDir.length + 1)}`)
      .filter((path) => path !== `/${SERVICE_WORKER_FILE}` && !path.endsWith('.map'))
      .sort();

    expect(precache.urls).toEqual(output);
    expect(precache.urls).toContain('/index.html');
    expect(precache.urls).toContain('/manifest.webmanifest');
    expect(precache.urls).toContain('/icons/apple-touch-icon.png');
    expect(precache.urls.some((url) => url.startsWith('/assets/') && url.endsWith('.js'))).toBe(
      true,
    );
    expect(precache.urls.filter((url) => url.startsWith('/api'))).toEqual([]);
  });

  it('bindet Manifest und Icons in index.html ein', () => {
    const html = readFileSync(join(outDir, 'index.html'), 'utf8');
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest"');
    expect(html).toContain('<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png"');
    expect(html).toContain('<meta name="theme-color"');
  });

  it('liefert ein Manifest, das die Installationsvoraussetzungen erfüllt', () => {
    const manifest = JSON.parse(readFileSync(join(outDir, 'manifest.webmanifest'), 'utf8')) as {
      name: string;
      short_name: string;
      start_url: string;
      scope: string;
      display: string;
      icons: { src: string; sizes: string; purpose: string }[];
    };
    expect(manifest).toMatchObject({
      name: 'Buchungsverwaltung',
      short_name: 'Buchungen',
      start_url: '/',
      scope: '/',
      display: 'standalone',
    });
    const sizes = manifest.icons.filter((icon) => icon.purpose === 'any').map((icon) => icon.sizes);
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
    for (const icon of manifest.icons) {
      expect(readdirSync(join(outDir, 'icons'))).toContain(icon.src.replace('/icons/', ''));
    }
  });
});
