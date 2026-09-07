import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';

/*
 * Absolute, derived from this file's own location. Two things to know:
 *
 * - a relative `cwd: '..'` is ambiguous: depending on how it resolves it
 *   lands either at the repo root or one directory above it, and the second
 *   silently runs some other project's `npm run dev`;
 * - `__dirname`, not import.meta.url, because Playwright loads the config as
 *   CommonJS — the root package.json has no "type": "module", so import.meta
 *   is a syntax error here even though the file is written as ESM.
 */
const repoRoot = resolve(__dirname, '..');

export default defineConfig({
  testDir: '.',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // one worker: every test shares one emulator, and they wipe Firestore
  workers: 1,
  fullyParallel: false,
  use: {
    ...devices['Pixel 5'],           // the spec is mobile-first
    // localhost, not 127.0.0.1: Vite binds to localhost, which resolves to
    // ::1 here, so polling the IPv4 literal never sees the server come up
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    cwd: repoRoot,
    reuseExistingServer: !process.env.CI,
    timeout: 90_000,
  },
});
