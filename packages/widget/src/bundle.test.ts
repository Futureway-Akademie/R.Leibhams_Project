// @vitest-environment node
// Prüft das tatsächlich gebaute IIFE-Bundle: Inhalt, Größe und mehrfaches Einbinden.
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { build } from 'vite';
import type { Rolldown } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ALLOWED_SHARED_FILES,
  WIDGET_CSS_FILE_NAME,
  WIDGET_CSS_SIZE_LIMIT_BYTES,
  WIDGET_FILE_NAME,
  WIDGET_SIZE_LIMIT_BYTES,
} from '../vite.config.js';

const CONFIG_FILE = fileURLToPath(new URL('../vite.config.ts', import.meta.url));
const WIDGET_SRC = fileURLToPath(new URL('./', import.meta.url));

let chunk: Rolldown.OutputChunk;
let assets: Rolldown.OutputAsset[];

beforeAll(async () => {
  const result = await build({
    configFile: CONFIG_FILE,
    logLevel: 'silent',
    build: { write: false, sourcemap: false },
  });
  const outputs = (Array.isArray(result) ? result : [result]) as Rolldown.RolldownOutput[];
  const chunks = outputs.flatMap((o) => o.output).filter((o) => o.type === 'chunk');
  expect(chunks).toHaveLength(1);
  const [only] = chunks;
  if (!only) throw new Error('Kein Bundle erzeugt');
  chunk = only;
  assets = outputs.flatMap((o) => o.output).filter((o) => o.type === 'asset');
}, 60_000);

function container(calendarId: string): string {
  return `<div data-fw-booking-calendar="${calendarId}" data-fw-booking-api="https://api.example.de" data-fw-booking-privacy-url="https://example.de/datenschutz"></div>`;
}

describe('Widget-Bundle', () => {
  it('ist eine einzelne Datei', () => {
    expect(chunk.fileName).toBe(WIDGET_FILE_NAME);
    expect(chunk.isEntry).toBe(true);
    expect(chunk.imports).toEqual([]);
    expect(chunk.dynamicImports).toEqual([]);
  });

  it('enthält nur Code aus packages/widget/src und freigegebene shared-Dateien', () => {
    const modules = Object.keys(chunk.modules).filter((id) => !id.startsWith('\0'));
    expect(modules.length).toBeGreaterThan(0);
    for (const id of modules) {
      expect(id.startsWith(WIDGET_SRC) || ALLOWED_SHARED_FILES.includes(id)).toBe(true);
    }
    expect(modules.some((id) => /node_modules|apps[\\/]portal|zod|temporal/i.test(id))).toBe(false);
    // Von shared nur die Intl-Formatierung, keine Schemas oder Temporal-Umrechnung.
    expect(modules.filter((id) => !id.startsWith(WIDGET_SRC))).toEqual(ALLOWED_SHARED_FILES);
  });

  it('liefert das Stylesheet als eigene Datei und nicht im Script', () => {
    const css = assets.find((a) => a.fileName === WIDGET_CSS_FILE_NAME);
    expect(assets.map((a) => a.fileName).filter((n) => n.endsWith('.css'))).toEqual([
      WIDGET_CSS_FILE_NAME,
    ]);
    const source = typeof css?.source === 'string' ? css.source : '';
    expect(source.startsWith('.fw-booking-root{')).toBe(true);
    expect(Buffer.byteLength(source)).toBeLessThan(WIDGET_CSS_SIZE_LIMIT_BYTES);
    // Kein Inline-<style> per Script (Content-Security-Policy).
    expect(chunk.code).not.toContain('fw-booking-color-accent');
    expect(chunk.code).not.toMatch(/createElement\([`'"]style[`'"]\)/);
  });

  it('bleibt unter dem Größenlimit', () => {
    expect(Buffer.byteLength(chunk.code)).toBeLessThan(WIDGET_SIZE_LIMIT_BYTES);
  });

  it('ist ein Skript ohne ES-Modul-Syntax', () => {
    expect(chunk.code).not.toMatch(/^\s*(import|export)\s/m);
  });

  it('initialisiert jeden Container bei mehrfach eingebundenem Script genau einmal', async () => {
    const script = `<script>${chunk.code}</script>`;
    // Das Script steht zweimal vor und einmal nach den Containern, wie bei mehreren Shortcodes.
    const dom = new JSDOM(
      `<!doctype html><html><head>${script}${script}</head><body>` +
        container('cal_AAAAAAAAAAAAAAAA') +
        container('cal_BBBBBBBBBBBBBBBB') +
        `${script}</body></html>`,
      { runScripts: 'dangerously' },
    );
    const doc = dom.window.document;
    // Die Scripts laufen während des Parsens; initialisiert wird erst nach DOMContentLoaded.
    expect(doc.querySelectorAll('.fw-booking-root')).toHaveLength(0);
    if (doc.readyState === 'loading') {
      await new Promise((resolve) => {
        doc.addEventListener('DOMContentLoaded', resolve);
      });
    }
    const containers = doc.querySelectorAll('[data-fw-booking-calendar]');
    expect(containers).toHaveLength(2);
    for (const el of containers) {
      expect(el.querySelectorAll('.fw-booking-root')).toHaveLength(1);
      expect(el.getAttribute('data-fw-booking-state')).toBe('ready');
    }
    const api = (dom.window as unknown as Window).FwBooking;
    expect(api?.version).toBe('0.1.0');
    // Der Build legt außer window.FwBooking keine weiteren globalen Namen an.
    expect(Object.keys(dom.window)).not.toContain('FwBookingWidget');
  });
});
