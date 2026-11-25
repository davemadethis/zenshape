# cookies

**Does** — `persistentCopy`: given an Onshape session cookie, returns the same cookie with a 30-day expiry. `main.ts` applies it to every new Onshape session cookie.

**Why it exists** — Onshape's login is a session cookie and Chromium discards session cookies on quit, so without this you're logged out on every relaunch (the `WORKAROUND:` comment in `cookies.ts`).

**Talks to** — `main.ts` (`ses.cookies.on('changed')`).

**Gotchas**
- Only `onshape.com` and subdomains. Re-setting a cookie fires `changed` again, but the copy isn't a session cookie, so it stops there.
- Host-only cookies must be set without `domain`, or they'd widen to the parent domain.
- Logging out still works: Onshape deletes the cookie, and deletions are ignored here.
- **No expiry keeps you signed in overnight.** Onshape ends idle sessions on its own server (hours without use), whatever the cookie says, so it asks for the password about daily, as in a browser. This only covers quits, relaunches and updates within that window. Making that sign-in quick is the sign-in tab's job (docs/tab-views.md).
- The cookie store's key is the keychain item "Zenshape Safe Storage", read once at launch by Chromium's async encryptor. `saved-sign-in.ts` uses the same encryptor so it adds no keychain prompt.
- Tokens now sit on disk for up to 30 days. Packaged builds encrypt the cookie store (fuse); dev builds don't.
