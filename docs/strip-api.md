# strip-api

**Does** — Types and channel names shared by the main process, the preload, and our page in all three modes (strip, divider, overlay).

**Why it exists** — The strip is the only renderer with a bridge; one file defines exactly what crosses it.

**Talks to** — `tab-views.ts`, `strip/preload.ts`, `strip/strip.ts`.

**Gotchas**
- `sign-in` carries the email, and the password or null (keep the saved one), from the splash view's Saved Sign-in page to main, once; main accepts it only from the splash view while that page shows, with each at most 1024 characters. State carries back only `savedSignIn.email`, never a password, and `signInRun` (the steps done, and where a run stopped and why).
- `move` names the tab to drop *before* (or null for the end of its group); the main process enforces the group rules, not the strip.
- `SAVED_PASSWORD_MASK`, `passwordToSend` and `canSignIn` are the Saved Sign-in page's field rules, here so they're unit-tested (`test/strip-api.test.ts`): the mask stands for the saved password and is never one; a value still holding a mask dot is never sent as a password. A password with a `•` in it (Option-8 types one, or a paste) can't be told from an edited mask, so it isn't sent, and the page says why (`passwordProblem`). `shouldFocusSignIn` moves focus to Sign in only while nothing in the form has it.
