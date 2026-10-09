import { describe, expect, it } from 'vitest';
import { formatDuration } from './format.js';

describe('formatDuration', () => {
  it.each([
    [5, '5 Min.'],
    [45, '45 Min.'],
    [60, '1 Std.'],
    [90, '1 Std. 30 Min.'],
    [480, '8 Std.'],
  ])('%i Minuten → %s', (minutes, text) => {
    expect(formatDuration(minutes)).toBe(text);
  });
});
