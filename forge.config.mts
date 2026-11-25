import { execFileSync } from 'node:child_process';
import path from 'node:path';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { PublisherGitHub } from '@electron-forge/publisher-github';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    appBundleId: 'com.zenshape.app',
    // Resolved per platform (.icns on macOS, .ico on Windows); rebuild with scripts/make-icons.sh.
    icon: 'assets/icon',
    // Registers zenshape:// in Info.plist; Windows/Linux register at runtime.
    protocols: [{ name: 'Zenshape', schemes: ['zenshape'] }],
  },
  rebuildConfig: {},
  hooks: {
    // Packaging rewrites Info.plist and flips fuses after Electron's own
    // ad-hoc signature, leaving it invalid; a downloaded copy then says
    // "Zenshape is damaged" with no way past it. Re-signing the bundle ad hoc
    // (no Developer ID) leaves the ordinary unverified-developer prompt
    // instead, which System Settings → Open Anyway gets past.
    postPackage: async (_config, { platform, outputPaths }) => {
      if (platform !== 'darwin') return;
      for (const dir of outputPaths) {
        const app = path.join(dir, 'Zenshape.app');
        execFileSync('codesign', ['--force', '--deep', '--sign', '-', app]);
      }
    },
  },
  makers: [
    new MakerSquirrel({
      setupExe: 'Zenshape-Setup.exe',
      setupIcon: 'assets/icon.ico',
    }),
    new MakerDMG({ icon: 'assets/icon.icns', format: 'ULFO' }, ['darwin']),
    // The zip is what a future signed macOS build would self-update from.
    new MakerZIP({}, ['darwin']),
    // The packaged binary is named after productName; these makers assume
    // the lowercase package name otherwise.
    new MakerRpm({
      options: {
        bin: 'Zenshape',
        mimeType: ['x-scheme-handler/zenshape'],
        icon: 'assets/icon.png',
      },
    }),
    new MakerDeb({
      options: {
        bin: 'Zenshape',
        mimeType: ['x-scheme-handler/zenshape'],
        icon: 'assets/icon.png',
      },
    }),
  ],
  // CI (.github/workflows/release.yml) publishes every OS's build into one
  // draft release for the pushed tag; it goes live when published by hand.
  publishers: [
    new PublisherGitHub({
      repository: { owner: 'davemadethis', name: 'zenshape' },
      draft: true,
      prerelease: false,
    }),
  ],
  plugins: [
    // Onshape pages get no preload; the preload and renderer here are only
    // for our own tab strip.
    new VitePlugin({
      build: [
        {
          entry: 'src/main.ts',
          config: 'vite.main.config.mts',
          target: 'main',
        },
        {
          entry: 'src/strip/preload.ts',
          config: 'vite.preload.config.mts',
          target: 'preload',
        },
      ],
      renderer: [{ name: 'strip', config: 'vite.renderer.config.mts' }],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
