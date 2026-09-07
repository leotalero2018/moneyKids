import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');
const config = readFileSync(resolve(appRoot, 'vite.config.ts'), 'utf8');

describe('PWA configuration', () => {
  it('declares the manifest fields an install prompt requires', () => {
    // Chrome refuses the install prompt without name, a 192 and a 512 icon,
    // display standalone, and a start_url
    for (const field of [
      'name', 'short_name', 'start_url', 'display', 'theme_color',
      'icon-192.png', 'icon-512.png', 'standalone',
    ]) {
      expect(config, field).toContain(field);
    }
  });

  it('registers the service worker automatically', () => {
    expect(config).toContain('registerType');
  });

  it('ships the icon files the manifest points at', () => {
    // a manifest naming icons that do not exist fails the install prompt
    // just as surely as one that omits them
    for (const icon of ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png']) {
      expect(existsSync(resolve(appRoot, 'public', icon)), icon).toBe(true);
    }
  });

  it('caches only the app shell, never authenticated data', () => {
    // a service worker caching Firestore or Storage responses is how one
    // family's data gets served to another
    expect(config).toContain('globPatterns');
    expect(config).not.toContain('firestore.googleapis.com');
    expect(config).not.toContain('firebasestorage');
  });
});
