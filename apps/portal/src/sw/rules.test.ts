import { describe, expect, it } from 'vitest';
import {
  APP_SHELL,
  CACHE_PREFIX,
  SKIP_WAITING,
  cacheKeyFor,
  cacheName,
  isSkipWaitingMessage,
  staleCaches,
} from './rules.js';
import type { RequestInfo } from './rules.js';

const ORIGIN = 'https://portal.example.de';
const PRECACHED = new Set([
  APP_SHELL,
  '/assets/index-abc123.js',
  '/assets/index-def456.css',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
]);

function request(path: string, init: Partial<RequestInfo> = {}): RequestInfo {
  return { method: 'GET', mode: 'cors', url: new URL(path, ORIGIN).href, ...init };
}

function keyFor(path: string, init: Partial<RequestInfo> = {}): string | null {
  return cacheKeyFor(request(path, init), ORIGIN, PRECACHED);
}

describe('cacheKeyFor', () => {
  it('beantwortet statische App-Dateien aus dem Build aus dem Cache', () => {
    expect(keyFor('/assets/index-abc123.js')).toBe('/assets/index-abc123.js');
    expect(keyFor('/assets/index-def456.css', { mode: 'no-cors' })).toBe(
      '/assets/index-def456.css',
    );
    expect(keyFor('/manifest.webmanifest')).toBe('/manifest.webmanifest');
    expect(keyFor('/icons/icon-192.png')).toBe('/icons/icon-192.png');
  });

  it('lässt API-Anfragen immer am Cache vorbei, auch Seitenaufrufe', () => {
    for (const path of [
      '/api/auth/session',
      '/api/owner/bookings?from=2026-10-01',
      '/api/owner/sessions/s1/participants',
      '/api',
    ]) {
      expect(keyFor(path)).toBeNull();
      expect(keyFor(path, { mode: 'navigate' })).toBeNull();
    }
  });

  it('beantwortet nur GET-Anfragen', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']) {
      expect(keyFor('/assets/index-abc123.js', { method })).toBeNull();
      expect(keyFor('/buchungen', { method, mode: 'navigate' })).toBeNull();
    }
  });

  it('ignoriert fremde Origins, auch bei gleichem Pfad', () => {
    const foreign = {
      method: 'GET',
      mode: 'cors',
      url: 'https://cdn.example.com/assets/index-abc123.js',
    };
    expect(cacheKeyFor(foreign, ORIGIN, PRECACHED)).toBeNull();
    const api = { method: 'GET', mode: 'cors', url: 'https://api.example.de/api/owner/bookings' };
    expect(cacheKeyFor(api, ORIGIN, PRECACHED)).toBeNull();
  });

  it('beantwortet unbekannte Dateien und Dateien mit Query nicht', () => {
    expect(keyFor('/assets/index-old999.js')).toBeNull();
    expect(keyFor('/assets/index-abc123.js?v=2')).toBeNull();
    expect(keyFor('/robots.txt')).toBeNull();
  });

  it('liefert für Seitenaufrufe im Portal die gespeicherte index.html', () => {
    for (const path of [
      '/',
      '/buchungen',
      '/buchungen/b1',
      '/kurstermine/regeln',
      '/login?next=%2F',
    ]) {
      expect(keyFor(path, { mode: 'navigate' })).toBe(APP_SHELL);
    }
  });

  it('liefert für Seitenaufrufe auf Dateien die Datei selbst oder nichts', () => {
    expect(keyFor('/manifest.webmanifest', { mode: 'navigate' })).toBe('/manifest.webmanifest');
    expect(keyFor('/robots.txt', { mode: 'navigate' })).toBeNull();
    expect(keyFor('/sw.js', { mode: 'navigate' })).toBeNull();
  });

  it('greift ohne gespeicherte index.html bei Seitenaufrufen nicht ein', () => {
    const navigate = request('/buchungen', { mode: 'navigate' });
    expect(cacheKeyFor(navigate, ORIGIN, new Set(['/assets/index-abc123.js']))).toBeNull();
  });
});

describe('staleCaches', () => {
  it('nennt nur ältere Portal-Caches, nicht den aktuellen und keine fremden', () => {
    const current = cacheName('v2');
    expect(
      staleCaches([cacheName('v1'), current, 'anderer-cache', `${CACHE_PREFIX}v0`], current),
    ).toEqual([cacheName('v1'), `${CACHE_PREFIX}v0`]);
  });
});

describe('isSkipWaitingMessage', () => {
  it('erkennt nur die Nachricht des Portals', () => {
    expect(isSkipWaitingMessage({ type: SKIP_WAITING })).toBe(true);
    expect(isSkipWaitingMessage({ type: 'SKIP_WAITING' })).toBe(false);
    expect(isSkipWaitingMessage(SKIP_WAITING)).toBe(false);
    expect(isSkipWaitingMessage(null)).toBe(false);
  });
});
