import { defineConfig } from 'vitest/config';
// Build-only tests: they run stage.mjs against a tmpdir fixture and need no
// emulator. The default config's `include` is ['src/**/*.test.ts'], which does
// not match this directory, so `npm test` and the emulator-gated
// `test:functions` never pick these up — no negative CLI filter needed.
export default defineConfig({
  test: { include: ['test/stage.test.ts'], fileParallelism: false, testTimeout: 20000 },
});
