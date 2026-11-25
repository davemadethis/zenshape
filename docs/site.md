# site

**Does** — `site/` is Zenshape's one-page website, built with Astro, which `.github/workflows/pages.yml` publishes with GitHub Pages at `https://davemadethis.github.io/zenshape/` on every push to `main`. It shows what Zenshape is, the banner and the animated SVG demos from `site-assets/`, download links to the latest release, the install steps for unsigned builds, and signing in.

**Why it exists** — A page for people who aren't on GitHub: what it is, a download button per OS, and how to get past the unsigned-build warnings.

**Talks to** — `src/disclaimer.ts` (the "is and isn't" points and the trademark line, imported so the site can't drift from the app), `assets/icon.svg` (the favicon), `site-assets/` (Astro's `publicDir`), GitHub's latest-release API (in the browser).

**Gotchas**
- **Its own package:** `site/package.json` and lockfile, apart from the app's. `npm --prefix site install`, then `npm --prefix site run dev` or `run build` (into `site/dist/`).
- **Base path:** Pages serves it under `/zenshape/` (`astro.config.mjs` `base`), so every link to a file is built from `import.meta.env.BASE_URL`, never a bare `/`.
- **Download links:** the macOS and Linux file names carry the version, so a small script fills each button from the latest release's asset list. Without it, or before the first release, they point at the latest release page. Windows links straight to `releases/latest/download/Zenshape-Setup.exe`, whose name never changes.
- **Demos are SVGs** (`site-assets/demos/`), animated with CSS inside each file, so they play in a plain `<img>` and load lazily. The site uses only these.
- **Wording:** "a browser built for Onshape".
- **Pages runs only on `davemadethis/zenshape`** (the workflow's `if`). Pages must be turned on in that repo's settings, with GitHub Actions as the source.
