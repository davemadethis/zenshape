# Zenshape

**A browser built for Onshape, with tabs, split view and a distraction-free zen mode.**

[Website](https://davemadethis.github.io/zenshape/) · [Download](https://github.com/davemadethis/zenshape/releases/latest)

- 🗂️ **Tabs.** Keep several Onshape documents and folders open in one window, then pin, rename and reorder them.
- 🪟 **Split view.** Drag a tab onto another tab, or onto an edge of the page, to see two side by side or stacked.
- 🧘 **Zen mode.** Onshape's menus and panels slide out of the way and come back when you move the mouse to the window's edge.
- 🔒 **Page locks.** Lock a tab to a document or folder, and links that lead elsewhere open in a new tab instead.
- 🔑 **Stays signed in.** Quit, reopen and update without logging back in to Onshape. Like a browser, Onshape still asks again after some hours without use, and then only for your password. Save your login in Zenshape and it's filled in for you.
- 🖥️ **macOS, Windows and Linux.**

## 💡 What it is

Zenshape is a small desktop browser that only opens [Onshape](https://www.onshape.com), PTC's browser-based CAD. Everything else a general browser has, like other sites, the address bar and extensions, is left out.

Under the hood it's an [Electron](https://www.electronjs.org) app: one window holds a separate, sandboxed browser view for each tab. Onshape runs in those views exactly as PTC serves it. Zenshape draws the tab bar around them and, in zen mode, adds a style sheet that rearranges what's on screen. It never runs its own code inside Onshape's pages.

It's a personal project by [Dave Seeman](https://github.com/davemadethis). It isn't connected to PTC.

### What Zenshape is and isn't

<!-- Same text as src/disclaimer.ts (shown at launch and in About). Keep them in step. -->

- Onshape runs exactly as PTC serves it. Zenshape adds no scripts, extensions or plug-ins to it and changes none of its code or data.
- Zen mode only restyles what’s on your own screen, like a browser’s dark-mode or zoom setting. It never hides Onshape’s copyright, legal notices, or plan and billing information.
- Zenshape doesn’t use the Onshape API, scrape or collect your data, automate your account, or get around Onshape’s sign-in, plans or limits. Your account talks only to Onshape.

Zenshape is not made, endorsed or supported by PTC Inc. PTC and Onshape are trademarks or registered trademarks of PTC Inc. or its subsidiaries in the U.S. and other countries.

## 🚀 Using it

Open Zenshape and sign in to Onshape. Onshape ends sessions after some hours without use, so expect its sign-in page about once a day, as in a browser; two-factor authentication stays remembered.

The first time Onshape asks, Zenshape shows its own sign-in page. Enter your email and password and click **Sign in** (or press Return): Zenshape saves the login, opens Onshape's page, types your email, presses Continue, types your password and presses Return, ticking off each step as it goes. If Onshape asks for more, like a code, you finish it. After that, Onshape's own sign-in page comes up with your email already in it: press Return, and your password appears; press Return again and you're in. Zenshape never presses those for you on that page, so you can sign in to another account instead: change the email, and it leaves the password field to you. The login is encrypted with your system's key store (the macOS keychain, Windows' DPAPI, or the Linux desktop keyring; without a keyring Linux won't save it). **Zenshape → Saved Sign-in…** changes it or signs in from Zenshape's page, and **Zenshape → Forget Saved Sign-in** deletes it.

After that:

| To | Do this |
| --- | --- |
| Open a new tab | ⌘T, or the **+** in the tab bar |
| Split two tabs | Drag a tab onto another tab, or onto the left, right, top or bottom of the page |
| Swap or rearrange a split | Click the small split icon on the grouped tab to swap; double-click it to switch between side by side and stacked |
| End a split | Right-click either tab → **Unsplit** |
| Pin, rename or lock a tab | Right-click the tab |
| Turn zen mode on or off | The **Z** button in the tab bar, or ⌃⌘Z |
| Bring back a hidden bar in zen mode | Move the mouse to that edge of the window |
| Hide the tab bar | ⌃⌘B; move the mouse to the top edge to show it again |
| Switch tabs | ⌘1 to ⌘8, ⌘9 for the last tab, ⌃Tab and ⌃⇧Tab |

Shortcuts are shown for macOS. On Windows and Linux, use Ctrl in place of ⌘. The ⌃⌘ shortcuts are macOS-only, so on other systems use the **Z** button. Windows and Linux have no menu bar: right-click the **Z** for the app menu (About, Saved Sign-in…, View, Window and the rest).

- **Zen mode on a document** hides Onshape's top bar, and slides the left-hand rail and the tab list along the bottom out of the way, so the model takes the whole window.
- **Zen mode on the documents list** keeps Onshape's top bar, footer, billing banner and plan buttons, and slides away the sidebar and side panels.
- **Pinned tabs** come back when you reopen Zenshape. To bring back every tab instead, turn on **Zenshape → Restore All Tabs on Launch**.

## 📦 Install

Download the file for your computer from the [latest release](https://github.com/davemadethis/zenshape/releases/latest). The builds aren’t code-signed, so your computer will warn you the first time.

**macOS 12 or later.** Use `arm64` for Apple Silicon or `x64` for Intel.
1. Open `Zenshape-<version>-<arch>.dmg` and drag Zenshape to Applications.
2. Open it. macOS says it can’t verify the developer: click **Done**.
3. Go to System Settings → Privacy & Security, scroll down to “Zenshape was blocked” and click **Open Anyway**, then confirm.

**Windows 10 or later (64-bit).**
1. Run `Zenshape-Setup.exe`.
2. If SmartScreen says “Windows protected your PC”, click **More info**, then **Run anyway**. Zenshape installs and opens without asking for admin rights.

**Linux (64-bit).**
- Debian or Ubuntu: `sudo apt install ./zenshape_<version>_amd64.deb`
- Fedora: `sudo dnf install ./zenshape-<version>-1.x86_64.rpm`

**macOS Keychain prompt:** after you install a new version, macOS may ask whether Zenshape can use “Zenshape Safe Storage” in your keychain. Click **Always Allow**, or you’ll be signed out of Onshape.

## 🔄 Updates

Zenshape checks this repository's releases once a day:
- **Windows** downloads updates in the background and asks to restart when one is ready.
- **macOS and Linux** show **Update available** in the tab bar and the app menu. Clicking it opens the download page; install the new version over the old one. Your tabs and sign-in carry over. Macs can't update themselves until builds are code-signed.

## 💬 Feedback

Found a bug, or did Onshape change in a way that broke zen mode? [Open an issue](https://github.com/davemadethis/zenshape/issues).

## 🛠️ Develop

Requires Node 24.

```sh
npm install
npm start          # dev build with its own profile ("Zenshape Dev")
npm test           # unit tests
npm run typecheck
npm run lint
npm run test:ui    # drives the app against live Onshape (sign in once with npm start first)
```

[`docs/`](docs) has a page for each module, saying what it does and why it works that way. The website is in [`site/`](site) (`npm --prefix site install`, then `npm --prefix site run dev`).

### Release

Pushing a `vX.Y.Z` tag that matches `package.json`'s version builds macOS (arm64 and x64 `.dmg` and `.zip`), Windows (`Zenshape-Setup.exe` plus its update files) and Linux (`.deb` and `.rpm`) into a **draft** release. Check the draft, then publish it, because installed copies only see published releases. See [`docs/release.md`](docs/release.md).

## 📄 License

Zenshape is free to use for any noncommercial purpose under the [PolyForm Noncommercial License 1.0.0](LICENSE).
