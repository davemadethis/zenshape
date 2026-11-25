import path from 'node:path';
import { defineConfig } from 'vite';

// The strip page lives in src/strip. Moving `root` would also move Forge's
// relative outDir, so pin it back to <project>/.vite/renderer/strip.
export default defineConfig((env) => ({
  root: path.join(env.root, 'src/strip'),
  build: {
    outDir: path.join(env.root, '.vite/renderer/strip'),
    emptyOutDir: true,
  },
}));
