import { describe, expect, it } from 'vitest';
import { RANGE_PRESETS, checkRange, rangeDays, rangeFromParams } from './range.js';

const TODAY = '2026-10-09';

describe('Zeitraum der Buchungsübersicht', () => {
  it('bietet Schnellauswahlen ab heute und rückwärts', () => {
    expect(RANGE_PRESETS.map((p) => [p.label, p.range(TODAY)])).toEqual([
      ['Heute', { from: TODAY, to: TODAY }],
      ['Nächste 7 Tage', { from: TODAY, to: '2026-10-15' }],
      ['Nächste 31 Tage', { from: TODAY, to: '2026-11-08' }],
      ['Letzte 31 Tage', { from: '2026-09-09', to: TODAY }],
    ]);
  });

  it('zählt Tage einschließlich beider Grenzen', () => {
    expect(rangeDays({ from: TODAY, to: TODAY })).toBe(1);
    expect(rangeDays({ from: '2026-10-01', to: '2026-12-31' })).toBe(92);
  });

  it('prüft Daten, Reihenfolge und Höchstdauer von 92 Tagen', () => {
    expect(checkRange({ from: '2026-10-01', to: '2026-12-31' })).toBeNull();
    expect(checkRange({ from: '2026-10-01', to: '2027-01-01' })).toBe('length');
    expect(checkRange({ from: '2026-10-10', to: '2026-10-09' })).toBe('order');
    expect(checkRange({ from: '', to: '2026-10-09' })).toBe('from');
    expect(checkRange({ from: TODAY, to: '2026-02-30' })).toBe('to');
  });

  it('liest den Zeitraum aus der Adresse, sonst ab heute 31 Tage', () => {
    expect(rangeFromParams(new URLSearchParams('von=2026-10-01&bis=2026-10-05'), TODAY)).toEqual({
      from: '2026-10-01',
      to: '2026-10-05',
    });
    expect(rangeFromParams(new URLSearchParams('von=2026-10-05&bis=2026-10-01'), TODAY)).toEqual({
      from: TODAY,
      to: '2026-11-08',
    });
    expect(rangeFromParams(new URLSearchParams(), TODAY).from).toBe(TODAY);
  });
});
