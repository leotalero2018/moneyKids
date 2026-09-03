import { describe, it, expect } from 'vitest';
import es from './es.json';
import en from './en.json';

function flatKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null
      ? flatKeys(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`]);
}

describe('translation resources', () => {
  it('has identical key sets in both languages', () => {
    // a key present in only one language renders as the raw key to that user
    const esKeys = flatKeys(es).sort();
    const enKeys = flatKeys(en).sort();
    expect(esKeys).toEqual(enKeys);
  });
  it('has no empty strings', () => {
    for (const resource of [es, en] as Record<string, unknown>[]) {
      for (const key of flatKeys(resource)) {
        const value = key.split('.').reduce<unknown>(
          (o, k) => (o as Record<string, unknown>)[k], resource);
        expect(value, key).not.toBe('');
      }
    }
  });
  it('ships Spanish as the default language', async () => {
    const { initI18n } = await import('./index.js');
    const i18n = await initI18n('es');
    expect(i18n.t('nav.inbox')).toBe('Facturas');
  });
});
