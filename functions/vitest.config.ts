import { defineConfig } from 'vitest/config';
export default defineConfig({
  // exclude is explicit so the split is visible from both configs, even
  // though include already scopes this to src/
  test: { include: ['src/**/*.test.ts'], exclude: ['test/**'], fileParallelism: false, testTimeout: 20000 },
});
