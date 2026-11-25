import { defineConfig } from 'astro/config';

// Served by GitHub Pages from the zenshape repo (docs/site.md).
export default defineConfig({
  site: 'https://davemadethis.github.io',
  base: '/zenshape',
  // The banner and the demo SVGs are kept where they were made, beside the site.
  publicDir: '../site-assets',
});
