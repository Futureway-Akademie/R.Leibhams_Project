// @vitest-environment node
// Prüft die Styling-Schnittstelle: Kapselung unter .fw-booking-root, Standardwerte aller Custom
// Properties, Dokumentation im README und keine verwaisten Klassen.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(fileURLToPath(new URL('./widget.css', import.meta.url)), 'utf8');
const README = readFileSync(fileURLToPath(new URL('../../README.md', import.meta.url)), 'utf8');
const SRC = fileURLToPath(new URL('../', import.meta.url));

/** Properties ohne Standardwert: ungesetzt erben Schrift und Zeilenhöhe vom Theme. */
const INHERITED = [
  '--fw-booking-font-family',
  '--fw-booking-font-size',
  '--fw-booking-line-height',
];

const css = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

/** Teilt eine Selektorliste an Kommas außerhalb von Klammern (z. B. :where(h3, h4)). */
function splitSelectorList(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of list) {
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (char === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current.trim());
  return parts;
}

/** Selektoren aller Regeln, auch innerhalb von @media. */
function selectors(text: string): string[] {
  const result: string[] = [];
  let buffer = '';
  for (const char of text) {
    if (char === '{') {
      const head = buffer.trim();
      if (!head.startsWith('@')) result.push(...splitSelectorList(head));
      buffer = '';
    } else if (char === '}' || char === ';') {
      buffer = '';
    } else {
      buffer += char;
    }
  }
  return result;
}

function rootBlock(): string {
  const match = /(?:^|\})\s*\.fw-booking-root\s*\{([^}]*)\}/.exec(css);
  if (!match?.[1]) throw new Error('Root-Regel fehlt');
  return match[1];
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(`${path}/`);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

describe('widget.css', () => {
  it('kapselt jede Regel unter .fw-booking-root', () => {
    const all = selectors(css);
    expect(all.length).toBeGreaterThan(50);
    for (const selector of all) {
      expect(selector, selector).toMatch(/^\.fw-booking-root(?=$|[\s.:[])/);
    }
  });

  it('verwendet !important nur für [hidden]', () => {
    const important = css.match(/[^;{}]*!important/g) ?? [];
    expect(important.map((d) => d.trim())).toEqual(['display: none !important']);
  });

  it('definiert jede verwendete Custom Property im Root (außer den geerbten Schriftwerten)', () => {
    const defined = new Set(
      [...rootBlock().matchAll(/(--fw-booking-[a-z-]+)\s*:/g)].map((m) => m[1]),
    );
    const used = new Set([...css.matchAll(/var\((--[a-z-]+)/g)].map((m) => m[1]));
    for (const name of used) {
      expect(name?.startsWith('--fw-booking-'), name).toBe(true);
      if (!INHERITED.includes(name ?? '')) expect(defined.has(name), name).toBe(true);
    }
    for (const name of INHERITED) {
      expect(used.has(name), name).toBe(true);
      expect(defined.has(name), name).toBe(false);
    }
  });

  it('deckt Farben, Schrift, Abstände und Fokus ab', () => {
    const block = rootBlock();
    for (const name of [
      '--fw-booking-color-text',
      '--fw-booking-color-accent',
      '--fw-booking-color-border',
      '--fw-booking-color-error',
      '--fw-booking-space-md',
      '--fw-booking-radius',
      '--fw-booking-focus-color',
      '--fw-booking-focus-width',
      '--fw-booking-focus-offset',
    ]) {
      expect(block).toContain(`${name}:`);
    }
    expect(css).toMatch(
      /\.fw-booking-root :focus-visible\s*\{[^}]*var\(--fw-booking-focus-color\)/,
    );
  });

  it('dokumentiert jede Custom Property im README', () => {
    const names = new Set([
      ...[...rootBlock().matchAll(/(--fw-booking-[a-z-]+)\s*:/g)].map((m) => m[1] ?? ''),
      ...INHERITED,
    ]);
    for (const name of names) expect(README, name).toContain(`\`${name}\``);
  });

  it('verwendet nur Klassen, die das Widget auch erzeugt', () => {
    const source = sourceFiles(SRC)
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');
    const classes = new Set([...css.matchAll(/\.fw-booking-([a-z-]+)/g)].map((m) => m[1] ?? ''));
    for (const name of classes) {
      // Modifier wie service--group entstehen per Template-String.
      const base = name.includes('--') ? name.split('--')[0] : name;
      expect(source.includes(`'${name}'`) || source.includes(`${base ?? ''}--`), name).toBe(true);
    }
  });
});
