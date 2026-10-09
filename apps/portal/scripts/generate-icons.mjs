// Erzeugt die App-Icons des Portals (SVG und PNG) aus einer gemeinsamen Geometrie, ohne
// Abhängigkeiten: Rechtecke mit runden Ecken, mehrfach abgetastet, PNG über zlib.
// Aufruf: pnpm --filter @fw-booking/portal icons
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';

const OUT_DIR = new URL('../public/icons/', import.meta.url);

const BLUE = '#1f5fbf';
const DARK_BLUE = '#0f3f8a';
const LIGHT_BLUE = '#d6e4fb';
const WHITE = '#ffffff';
const ACCENT = '#f0a500';

/** Neutrales Kalendersymbol im 512er-Raster; liegt vollständig in der Safe Zone (Radius 40 %). */
const GLYPH = [
  { x: 128, y: 144, w: 256, h: 256, r: 28, fill: WHITE },
  { x: 128, y: 144, w: 256, h: 64, r: 28, fill: LIGHT_BLUE },
  { x: 128, y: 180, w: 256, h: 28, r: 0, fill: LIGHT_BLUE },
  { x: 180, y: 112, w: 28, h: 64, r: 14, fill: DARK_BLUE },
  { x: 304, y: 112, w: 28, h: 64, r: 14, fill: DARK_BLUE },
  ...[168, 236, 304].flatMap((x, column) =>
    [244, 316].map((y, row) => ({
      x,
      y,
      w: 40,
      h: 40,
      r: 8,
      fill: column === 2 && row === 1 ? ACCENT : BLUE,
    })),
  ),
];

/** „any“: abgerundete Kachel mit transparenten Ecken; „full“: vollflächig (maskable, Apple). */
function shapes(variant) {
  const background = { x: 0, y: 0, w: 512, h: 512, r: variant === 'any' ? 96 : 0, fill: BLUE };
  return [background, ...GLYPH];
}

function toSvg(variant) {
  const rects = shapes(variant).map(
    ({ x, y, w, h, r, fill }) =>
      `<rect x="${String(x)}" y="${String(y)}" width="${String(w)}" height="${String(h)}"${r > 0 ? ` rx="${String(r)}"` : ''} fill="${fill}"/>`,
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${rects.join('')}</svg>\n`;
}

function inside({ x, y, w, h, r }, px, py) {
  if (px < x || px > x + w || py < y || py > y + h) return false;
  const dx = Math.max(x + r - px, px - (x + w - r), 0);
  const dy = Math.max(y + r - py, py - (y + h - r), 0);
  return dx * dx + dy * dy <= r * r;
}

function rgb(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

/** Rastert die Formen auf size × size Pixel (4 × 4 Abtastpunkte je Pixel, vormultipliziert). */
function rasterize(variant, size) {
  const list = shapes(variant).map((shape) => ({ ...shape, rgb: rgb(shape.fill) }));
  const samples = 4;
  const scale = 512 / size;
  const pixels = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const x = (px + (sx + 0.5) / samples) * scale;
          const y = (py + (sy + 0.5) / samples) * scale;
          for (let i = list.length - 1; i >= 0; i--) {
            const shape = list[i];
            if (inside(shape, x, y)) {
              r += shape.rgb[0];
              g += shape.rgb[1];
              b += shape.rgb[2];
              a += 1;
              break;
            }
          }
        }
      }
      const offset = (py * size + px) * 4;
      if (a > 0) {
        pixels[offset] = Math.round(r / a);
        pixels[offset + 1] = Math.round(g / a);
        pixels[offset + 2] = Math.round(b / a);
      }
      pixels[offset + 3] = Math.round((a / (samples * samples)) * 255);
    }
  }
  return pixels;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function toPng(variant, size) {
  const pixels = rasterize(variant, size);
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    // Filtertyp 0 je Zeile, danach die RGBA-Werte.
    pixels.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8 Bit, RGBA, Standardkompression, -filter, kein Interlacing
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const FILES = [
  ['icon.svg', () => toSvg('any')],
  ['icon-192.png', () => toPng('any', 192)],
  ['icon-512.png', () => toPng('any', 512)],
  ['icon-maskable-512.png', () => toPng('full', 512)],
  ['apple-touch-icon.png', () => toPng('full', 180)],
];

mkdirSync(OUT_DIR, { recursive: true });
for (const [name, render] of FILES) {
  const content = render();
  writeFileSync(new URL(name, OUT_DIR), content);
  console.log(`${name}: ${String(content.length)} Bytes`);
}
