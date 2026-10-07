// Legt ein Owner-Konto an: pnpm --filter @fw-booking/api owner:create -- --email owner@example.de
// Das Passwort wird verdeckt abgefragt (oder bei nicht interaktivem Aufruf von stdin gelesen)
// und weder angezeigt noch geloggt.
import { parseArgs } from 'node:util';
import { MongoClient } from 'mongodb';
import { ConfigError, loadConfig } from '../config/config.js';
import { OwnerCreationError, createOwner } from './owners.js';

function readHidden(prompt: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    return new Promise((resolve) => {
      let data = '';
      stdin.setEncoding('utf8');
      stdin.on('data', (chunk: string) => (data += chunk));
      stdin.on('end', () => {
        resolve(data.replace(/\r?\n$/, ''));
      });
    });
  }
  process.stdout.write(prompt);
  return new Promise((resolve) => {
    let input = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (char: string) => {
      if (char === '\r' || char === '\n') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.off('data', onData);
        process.stdout.write('\n');
        resolve(input);
      } else if (char === '\u0003') {
        process.stdout.write('\n');
        process.exit(130);
      } else if (char === '\u007f') {
        input = input.slice(0, -1);
      } else {
        input += char;
      }
    };
    stdin.on('data', onData);
  });
}

async function main(): Promise<number> {
  // pnpm reicht ein einzelnes `--` als Argument durch; es wird ignoriert.
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((arg) => arg !== '--'),
    options: { email: { type: 'string' } },
  });
  if (!values.email) {
    console.error('Aufruf: owner:create -- --email <adresse>');
    return 1;
  }

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      return 1;
    }
    throw error;
  }

  const password = await readHidden('Passwort: ');
  if (process.stdin.isTTY) {
    const repeat = await readHidden('Passwort wiederholen: ');
    if (repeat !== password) {
      console.error('Die Passwörter stimmen nicht überein.');
      return 1;
    }
  }

  const client = new MongoClient(config.mongodb.uri, { serverSelectionTimeoutMS: 5_000 });
  try {
    await client.connect();
    const id = await createOwner(client.db(config.mongodb.dbName), values.email, password);
    console.log(`Owner angelegt (ID ${id.toHexString()}).`);
    return 0;
  } catch (error) {
    console.error(
      error instanceof OwnerCreationError
        ? error.message
        : `Anlegen fehlgeschlagen (${(error as Error).name})`,
    );
    return 1;
  } finally {
    await client.close();
  }
}

process.exitCode = await main();
