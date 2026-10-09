import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { takeManageToken } from './token.js';

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';

function windowAt(url: string): Window {
  return new JSDOM('<!doctype html><html><body></body></html>', { url })
    .window as unknown as Window;
}

describe('takeManageToken', () => {
  it('liest das Token aus dem Fragment und entfernt es aus der Adresse', () => {
    const win = windowAt(`https://kunde.example.de/termine/?seite=2#t=${TOKEN}`);
    const before = win.history.length;
    expect(takeManageToken(win)).toEqual({ kind: 'token', token: TOKEN });
    expect(win.location.href).toBe('https://kunde.example.de/termine/?seite=2');
    expect(win.location.hash).toBe('');
    expect(win.location.href).not.toContain(TOKEN);
    // replaceState: kein zusätzlicher Verlaufseintrag mit dem Token.
    expect(win.history.length).toBe(before);
  });

  it('meldet ein ungültiges Token und entfernt es trotzdem', () => {
    const win = windowAt('https://kunde.example.de/termine/#t=kurz');
    expect(takeManageToken(win)).toEqual({ kind: 'invalid' });
    expect(win.location.href).toBe('https://kunde.example.de/termine/');
  });

  it('ignoriert Seiten ohne Verwaltungslink und lässt fremde Fragmente stehen', () => {
    for (const url of ['https://kunde.example.de/', 'https://kunde.example.de/#kontakt']) {
      const win = windowAt(url);
      expect(takeManageToken(win)).toBeNull();
      expect(win.location.href).toBe(url);
    }
  });
});
