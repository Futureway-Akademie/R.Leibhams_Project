import { describe, expect, it } from 'vitest';
import { packageName } from './index.js';

describe('@fw-booking/shared', () => {
  it('ist im Workspace auflösbar', () => {
    expect(packageName).toBe('@fw-booking/shared');
  });
});
