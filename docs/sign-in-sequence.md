# sign-in-sequence

**Does** — `signIn`: drives Onshape's sign-in page for the Sign in button: types the saved email, presses Return (Continue), waits for the password field, types the password, presses Return, then waits to leave the sign-in page, reporting each step as it's done.

**Why it exists** — Sign-in is meant to be one click on Zenshape's page. Kept apart from `tab-views.ts` behind a small `SignInPage` interface, so every step's rule is unit-tested with a fake page and clock (`test/sign-in-sequence.test.ts`).

**Talks to** — `tab-views.ts` (`runSignIn` gives it the watched page: the focus read, `insertText`, `pressReturn`, and the URL check), `sign-in-focus.ts` (types only).

**Gotchas**
- Each step runs only while `onSignInPage()` holds (still the sign-in tab, still on Onshape's sign-in URL), checked before every read, type and key. A redirect anywhere stops it, and what's left is never typed.
- Each field is typed only if it has focus, is the matching kind and is empty. A field with text stops the run with a reason; nothing is overwritten.
- After Continue it polls the focus every 150 ms for 10 s (`TIMING`). Onshape focused its password field by itself 158 ms after Continue (seen 2026-11-19). On a timeout it types no password and returns `needs-you` at the password step: the rest is the user's.
- Its typing steps are the fill routine's `fillField` (trigger `run`) and its keys the routine's `pressReturn` (`docs/sign-in-fill.md`): every guard, the re-read after the decrypt and the account check live there. A `busy` answer (another fill in flight) is "not yet": it waits and tries again until the timeout.
- After the password's Return, the password field focused empty again (most likely a wrong password) is `needs-you` at the password step, not "asks for more".
- The email step waits the same way, since the page may still be loading behind Zenshape's page.
- It never presses anything past the password's Return. After it, leaving the sign-in page is `left` (the caller checks it landed signed in). Still on the page, the password field focused empty again is `needs-you` at the password step (most likely a wrong password); any other empty field (a code), or no change in 10 s, is `needs-you` at the last step: the user's to finish on Onshape's page.
- `stepDone` fires after each Return, so the page's step list ticks off live; every stop names its step (`needs-you`), and `left` names the last step done.
- The email step waits for the email field to have focus, empty or not: the routine judges text there (`already` when it's the saved email, which counts as typed).
