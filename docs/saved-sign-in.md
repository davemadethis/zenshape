# saved-sign-in

**Does** — `SavedSignIn`: saves one Onshape email and password encrypted with Electron's `safeStorage`, reads either back for a single fill, and forgets it.

**Why it exists** — Onshape ends idle sessions on its server, so it asks for the password about daily (`docs/cookies.md`). Electron ships no password manager, and 1Password's ⌘\ fills nothing in this app, so Zenshape keeps the one login it needs, the way a browser does.

**Talks to** — Electron's `safeStorage` (passed in), `tab-views.ts` (save from Zenshape's sign-in page, the email for that page, each fill), `main.ts` (creates it at `userData/saved-sign-in.json`; Forget).

**Gotchas**
- **Async calls only.** Chromium has two encryptors keyed by the same keychain item ("Zenshape Safe Storage"): the async one (`os_crypt_async`), which the cookie store uses, and the sync `OSCrypt`. Each reads the item from the keychain on its own (`KeychainPassword::GetPassword`), and on macOS each read by a new ad-hoc build is a round of keychain prompts. The cookie store reads it at launch, so the async calls reuse that key and Save and fills add no prompt; the sync ones (`encryptString`, `decryptString`, even `isEncryptionAvailable`) would add a second round. Seen in a build that used the sync calls: it asked at launch and again at the first fill.
- `exists` only looks for the file. Deciding whether a login is saved never touches the key store.
- On Linux with no keyring, `getSelectedStorageBackend()` is `basic_text`: a key hard-coded in Chromium. Saving is refused there, with a message.
- A save is reported only after the file decrypts back to what was typed. The file holds base64 ciphertext only and is written to a temp file, then renamed.
- The password's plain text is never kept: each `read('password')` decrypts for one fill. The email is decrypted once and kept for the sign-in page's account readings, which ask several times a second (a failed decrypt isn't kept); `save` and `forget` drop it and bump `version`, and the fill routine drops anything worked out from the old login. Nothing logs either, and no message shows them.
