import { defineConfig } from 'vitest/config';

// The CI smoke test: the installed app is already running (started by
// .github/workflows/smoke.yml); the checks build on each other, in order.
export default defineConfig({
  test: {
    include: ['test/smoke/**/*.test.ts'],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
