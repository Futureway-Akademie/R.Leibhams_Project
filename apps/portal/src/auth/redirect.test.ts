import { describe, expect, it } from 'vitest';
import { redirectTarget } from './redirect.js';

describe('redirectTarget', () => {
  it('übernimmt Pfade innerhalb des Portals mit Suche und Fragment', () => {
    expect(redirectTarget({ from: '/buchungen?status=confirmed#oben' })).toBe(
      '/buchungen?status=confirmed#oben',
    );
  });

  it.each([
    undefined,
    null,
    'text',
    {},
    { from: 42 },
    { from: 'https://fremd.example/' },
    { from: '//fremd.example/' },
    { from: '/\\fremd.example/' },
    { from: 'angebote' },
    { from: '/login' },
    { from: '/login?x=1' },
  ])('fällt bei %j auf die Startseite zurück', (state) => {
    expect(redirectTarget(state)).toBe('/');
  });
});
