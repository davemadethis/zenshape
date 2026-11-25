import { defineConfig } from 'vitest/config';

// The UI suite: one app instance (started in global-setup) shared by every
// file, so files run one at a time.
export default defineConfig({
  test: {
    include: ['test/ui/**/*.ui.test.ts'],
    globalSetup: ['test/ui/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
