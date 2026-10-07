import { describe, expect, it } from 'vitest';
import { packageName } from './index.js';

describe('@fw-booking/api', () => {
  it('ist im Workspace auflösbar', () => {
    expect(packageName).toBe('@fw-booking/api');
  });
});
