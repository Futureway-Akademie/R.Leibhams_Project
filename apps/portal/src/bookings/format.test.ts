import { describe, expect, it } from 'vitest';
import { mailtoHref, telHref } from './format.js';

describe('Kontakt-Links', () => {
  it('erzeugt tel:-Links nur aus Ziffern und führendem Plus', () => {
    expect(telHref('030 / 123 45-6')).toBe('tel:030123456');
    expect(telHref(' +49 (30) 1234567')).toBe('tel:+49301234567');
  });

  it('erzeugt mailto:-Links mit kodierten Sonderzeichen', () => {
    expect(mailtoHref('anna.muster@example.test')).toBe('mailto:anna.muster@example.test');
    expect(mailtoHref('a+b@example.test')).toBe('mailto:a%2Bb@example.test');
  });
});
