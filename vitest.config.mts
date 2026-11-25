import { configDefaults, defineConfig } from 'vitest/config';

// Unit tests only. The UI suite (test/ui) launches the real app against live
// Onshape and runs separately: `npm run test:ui`. vitest's own excludes stay:
// they cover .git/, which can hold worktrees.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'scripts/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'test/ui/**', 'test/smoke/**'],
  },
});
