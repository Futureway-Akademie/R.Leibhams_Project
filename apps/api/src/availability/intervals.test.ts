import { describe, expect, it } from 'vitest';
import { clipIntervals, mergeIntervals, subtractIntervals } from './intervals.js';

const i = (start: number, end: number) => ({ start, end });

describe('mergeIntervals', () => {
  it('vereinigt überlappende und angrenzende Intervalle', () => {
    expect(mergeIntervals([i(5, 8), i(0, 3), i(3, 4), i(7, 10)])).toEqual([i(0, 4), i(5, 10)]);
  });
  it('verwirft leere Intervalle', () => {
    expect(mergeIntervals([i(2, 2), i(5, 4)])).toEqual([]);
  });
});

describe('subtractIntervals', () => {
  it('schneidet eine Lücke heraus', () => {
    expect(subtractIntervals([i(0, 10)], [i(3, 5)])).toEqual([i(0, 3), i(5, 10)]);
  });
  it('entfernt vollständig überdeckte Intervalle', () => {
    expect(subtractIntervals([i(2, 4), i(6, 8)], [i(0, 10)])).toEqual([]);
  });
  it('kürzt an den Rändern', () => {
    expect(subtractIntervals([i(0, 10)], [i(-5, 2), i(8, 20)])).toEqual([i(2, 8)]);
  });
  it('lässt nicht überlappende Intervalle unverändert', () => {
    expect(subtractIntervals([i(0, 3)], [i(3, 5)])).toEqual([i(0, 3)]);
  });
});

describe('clipIntervals', () => {
  it('schneidet auf den Bereich zu', () => {
    expect(clipIntervals([i(-5, 3), i(4, 6), i(9, 15)], i(0, 10))).toEqual([
      i(0, 3),
      i(4, 6),
      i(9, 10),
    ]);
  });
});
