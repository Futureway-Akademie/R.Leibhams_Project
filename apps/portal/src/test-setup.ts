import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom kennt kein Scrollen; die Navigation ruft scrollIntoView auf (Build-Tests laufen ohne DOM).
if (typeof Element !== 'undefined' && !('scrollIntoView' in Element.prototype)) {
  Object.defineProperty(Element.prototype, 'scrollIntoView', { value: () => undefined });
}

afterEach(() => {
  cleanup();
});
