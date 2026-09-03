import { describe, it, expect } from 'vitest';
import { STARTER_CATALOG, catalogPriceInMinor } from './catalog.js';

describe('starter catalog', () => {
  it('covers all four pillars', () => {
    const pillars = new Set(STARTER_CATALOG.map((e) => e.category));
    expect([...pillars].sort()).toEqual(['courage', 'help', 'ideas', 'learn']);
  });
  it('is fully bilingual with rule-safe lengths', () => {
    for (const entry of STARTER_CATALOG) {
      expect(entry.titleEs.length).toBeGreaterThan(0);
      expect(entry.titleEn.length).toBeGreaterThan(0);
      // the activity rules cap titles at 80 and descriptions at 500
      expect(entry.titleEs.length).toBeLessThanOrEqual(80);
      expect(entry.titleEn.length).toBeLessThanOrEqual(80);
      expect(entry.descriptionEs.length).toBeLessThanOrEqual(500);
      expect(entry.descriptionEn.length).toBeLessThanOrEqual(500);
    }
  });
  it('scales suggested prices into the family currency minor units', () => {
    // 5 major units is 500 cents in USD but 5 pesos in COP
    expect(catalogPriceInMinor(5, 'USD')).toBe(500);
    expect(catalogPriceInMinor(5, 'COP')).toBe(5);
  });
});
