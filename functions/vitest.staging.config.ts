import { defineConfig } from 'vitest/config';
// Build-only tests: they run stage.mjs against a tmpdir fixture and need no
// emulator, so they are kept out of the default config's include rather than
// filtered out of it on the command line.
export default defineConfig({
  test: { include: ['test/stage.test.ts'], fileParallelism: false, testTimeout: 20000 },
});
