// Kopiert das gebaute Widget (packages/widget/dist) in das WordPress-Plugin, damit WordPress
// Script und Stylesheet von der eigenen Domain ausliefert. Aufruf: pnpm wp:assets
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../../packages/widget/dist/', import.meta.url));
const target = fileURLToPath(new URL('./fw-booking/assets/', import.meta.url));
const files = ['fw-booking-widget.js', 'fw-booking-widget.css'];

mkdirSync(target, { recursive: true });
for (const file of files) {
  if (!existsSync(`${source}${file}`)) {
    console.error(`${file} fehlt in packages/widget/dist – zuerst das Widget bauen.`);
    process.exit(1);
  }
  copyFileSync(`${source}${file}`, `${target}${file}`);
  console.log(`kopiert: ${file}`);
}
