import { describe, expect, it } from 'vitest';
import { moveService } from './order.js';

const ALL = ['a', 'b', 'c', 'd'];

describe('moveService', () => {
  it('tauscht mit dem Nachbarn, wenn alle Angebote sichtbar sind', () => {
    expect(moveService(ALL, ALL, 'c', 'up')).toEqual(['a', 'c', 'b', 'd']);
    expect(moveService(ALL, ALL, 'b', 'down')).toEqual(['a', 'c', 'b', 'd']);
  });

  it('verschiebt bei aktivem Filter am sichtbaren Nachbarn vorbei', () => {
    // b und c sind ausgeblendet: d rückt vor a, a hinter d.
    expect(moveService(ALL, ['a', 'd'], 'd', 'up')).toEqual(['d', 'a', 'b', 'c']);
    expect(moveService(ALL, ['a', 'd'], 'a', 'down')).toEqual(['b', 'c', 'd', 'a']);
  });

  it('liefert null am Rand oder bei unbekannten IDs', () => {
    expect(moveService(ALL, ALL, 'a', 'up')).toBeNull();
    expect(moveService(ALL, ALL, 'd', 'down')).toBeNull();
    expect(moveService(ALL, ALL, 'x', 'up')).toBeNull();
    expect(moveService(ALL, ['a', 'x'], 'x', 'up')).toBeNull();
  });
});
