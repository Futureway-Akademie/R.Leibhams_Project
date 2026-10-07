import { describe, expect, it } from 'vitest';
import {
  differsFromDeviceTimeZone,
  formatDate,
  formatDateTime,
  formatTime,
  formatTimeRange,
} from './format.js';

const BERLIN = 'Europe/Berlin';

describe('Formatierung in der Zeitzone der Installation', () => {
  it('formatiert Datum und Uhrzeit auf Deutsch', () => {
    expect(formatDate('2026-10-08T08:00:00Z', BERLIN)).toBe('Do., 8. Okt. 2026');
    expect(formatTime('2026-10-08T08:00:00Z', BERLIN)).toBe('10:00');
    expect(formatDateTime('2026-10-08T08:00:00Z', BERLIN)).toBe('Do., 8. Okt. 2026, 10:00');
  });

  it('formatiert unabhängig von der Gerätezeitzone', () => {
    expect(formatTime('2026-10-08T08:00:00Z', 'America/New_York')).toBe('04:00');
  });

  it('formatiert Zeitspannen', () => {
    expect(formatTimeRange('2026-10-08T08:00:00Z', '2026-10-08T08:30:00Z', BERLIN)).toBe(
      '10:00–10:30',
    );
  });

  it('unterstützt andere Sprachen', () => {
    expect(formatDate('2026-10-08T08:00:00Z', BERLIN, 'en-GB')).toBe('Thu, 8 Oct 2026');
  });
});

describe('differsFromDeviceTimeZone', () => {
  it('vergleicht mit der Gerätezeitzone', () => {
    expect(differsFromDeviceTimeZone(BERLIN, BERLIN)).toBe(false);
    expect(differsFromDeviceTimeZone(BERLIN, 'Europe/London')).toBe(true);
  });
});
