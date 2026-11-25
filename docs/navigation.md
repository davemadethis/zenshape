# navigation

**Does** — Pure URL policy: which hosts count as Onshape, what `window.open` should do, the new-tab home page, sign-in pages, lock scopes, and the user-agent cleanup.

**Why it exists** — Keeps the security- and navigation-relevant decisions free of Electron so they're unit-tested directly (`test/navigation.test.ts`).

**Talks to** — `tab-views.ts` (navigation policy, sign-in tab, locks, `window.open`), `main.ts` (`cleanUserAgent`).

**Gotchas**
- `isDocumentUrl` (a `/documents/<24-hex id>` page) decides where zen hides Onshape's top bar, and so the gutter's color.
- `isDrawingFrameFor(frameUrl, pageUrl)`: a frame on a drawing host whose `elementId` is the element in the page's URL. The id check matters because Onshape may keep a drawing's frame after you switch to another element.
- Onshape means `https:` and host `onshape.com` or `*.onshape.com`. `http:` is rejected.
- `about:blank` is allowed as an in-app window because pages open blank windows and then navigate them; the child still gets the navigation policy.
- `ONSHAPE_HOME` is `/documents`, not the site root: signed in, the root hops through `/signin`, which the sign-in tab would mistake for a logout.
- `isSignInPage`: `/signin*` on any Onshape host, or `oauth.onshape.com`.
- `lockScope`: `doc:<24-hex id>` for `/documents/<id>…` (any workspace/version/tab of that document), `node:<nodeId>` for list pages, else `path:<pathname>`. `inLockScope` compares scopes.
- `cleanUserAgent` strips the `<AppName>/x.y` and `Electron/x.y` tokens: Zenshape's user agent is Chromium's without them.
