# sign-in-sequence

**Does** — `signIn`: drives Onshape's sign-in page for the Sign in button: types the saved email, presses Return (Continue), waits for the password field, types the password, presses Return, then waits to leave the sign-in page, reporting each step as it's done.

**Why it exists** — Sign-in is meant to be one click on Zenshape's page. Kept apart from `tab-views.ts` behind a small `SignInPage` interface, so every step's rule is unit-tested with a fake page and clock (`test/sign-in-sequence.test.ts`).

**Talks to** — `tab-views.ts` (`runSignIn` gives it the watched page: the focus read, `insertText`, `pressReturn`, and the URL check), `sign-in-focus.ts` (types only).

**Gotchas**

- Each step runs only while `onSignInPage()` holds (still the sign-in tab, still on Onshape's sign-in URL), checked before every read, type and key. A redirect anywhere stops it, and what's left is never typed.
- Each field is typed only if it has focus, is the matching kind and is empty. A field with text stops the run with a reason; nothing is overwritten.
- After Continue it polls the focus every 150 ms for 10 s (`TIMING`). Onshape focused its password field by itself 158 ms after Continue (seen 2026-11-19). On a timeout it types no password and returns `needs-you` at the password step: the rest is the user's.
- Its typing steps are the fill routine's `fillField` (trigger `run`) and its keys the routine's `pressReturn` (`docs/sign-in-fill.md`): every guard, the re-read after the decrypt and the account check live there. A `busy` answer (another fill in flight) is "not yet": it waits and tries again until the timeout.
- After the password's Return, the password field focused empty again (most likely a wrong password) is `needs-you` at the password step, not a hand-over, but only once it has stayed focused and empty on every read for `settleMs` (2 s): Onshape empties or hides that field on its way to its code step (seen on a fresh Windows install, 2026-11-25). A read with text, another field or no field in between restarts the count, and a count under way runs its full `settleMs` even past the 10 s timeout. So a moment of no field restarts it too: if focus leaves the page (the user switches apps) during those 2 s, the count starts again when it comes back.
- The email step waits the same way, since the page may still be loading behind Zenshape's page.
- It never presses anything past the password's Return. After it, leaving the sign-in page is `left` (the caller checks it landed signed in). Still on the page, the password field focused empty for `settleMs` is `needs-you` at the password step (most likely a wrong password). An empty field of Onshape's own (kind `other`, a code) is `handed-over`: Onshape took the password, so the caller shows every step done and brings Onshape's page forward for the code, as a sign-in looks when Onshape asks nothing more. The email field empty (Onshape back at its start) is `needs-you` at the last step, never a hand-over, so a sign-in that didn't take never looks signed in. No change in 10 s is `needs-you` at the last step too.
- The hand-over trusts any focused empty `other` input, not just a code field: a checkbox, a radio or a captcha's field would count too. Onshape's code field is `input type=password name=totpCode` (seen 2026-11-25), which `kindOf` reads as `other`.
- The run works on Onshape's page while Zenshape's page covers it. That only works because the splash is never fully opaque: on Windows a fully covered page counts as hidden and drops keys (`docs/strip/strip.md`).
- `stepDone('email')` fires once Onshape shows its password step (or leaves the page), not on the Return, so a green tick means Onshape took it. `stepDone('password')` fires after its Return. The page's step list ticks off live; every stop names its step (`needs-you`), `left` names the last step done, and `handed-over` means all of them.
- The email step waits for the email field to have focus, empty or not: the routine judges text there (`already` when it's the saved email, which counts as typed).
