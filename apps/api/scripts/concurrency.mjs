// Lastlauf der Nebenläufigkeitstests mit gesicherter Ausgabe.
// Aufruf: pnpm --filter @fw-booking/api test:concurrency
// Anpassbar über CONCURRENCY_LOAD (Standard 200) und CONCURRENCY_ROUNDS (Standard 20).
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const logDir = join(root, 'logs');
mkdirSync(logDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const logFile = join(logDir, `concurrency-${stamp}.log`);
const log = createWriteStream(logFile);

const env = {
  ...process.env,
  CONCURRENCY_LOAD: process.env.CONCURRENCY_LOAD ?? '200',
  CONCURRENCY_ROUNDS: process.env.CONCURRENCY_ROUNDS ?? '20',
};
const header = `Lastlauf: ${env.CONCURRENCY_LOAD} parallele Anfragen, ${env.CONCURRENCY_ROUNDS} Durchläufe\n`;
process.stdout.write(header);
log.write(header);

const child = spawn('pnpm', ['exec', 'vitest', 'run', 'src/concurrency', '--reporter=verbose'], {
  cwd: root,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});
for (const stream of [child.stdout, child.stderr]) {
  stream.on('data', (chunk) => {
    process.stdout.write(chunk);
    log.write(chunk);
  });
}
child.on('close', (code) => {
  const footer = `\nErgebnis: ${code === 0 ? 'bestanden' : 'FEHLGESCHLAGEN'} – Log: ${logFile}\n`;
  process.stdout.write(footer);
  log.end(footer);
  process.exitCode = code ?? 1;
});
