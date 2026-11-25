# sign-in-log

**Does** — `signInLog`: appends one line per sign-in event to `sign-in.log` in the app's logs folder (macOS: `~/Library/Logs/Zenshape/sign-in.log`; dev, UI-test and scratch runs write `sign-in-dev.log` instead).

**Why it exists** — The sign-in runs against Onshape's live page on your own account, which no test or scratch run can submit to. When it misbehaves there, this trail says what happened without anyone asking for the login.

**Talks to** — `main.ts` (`startSignInLog(app.getPath('logs'))` at ready), `tab-views.ts` (the events).

**Gotchas**
- Never a value: events, timings, host and path of the page (`where`, never the query), the focused field's kind and whether it's empty, and which view has focus. No email, password or field text.
- Events: `sign-in page` / `sign-in held` (diverts and the loop breaker), `watch`, `sign-in pressed` / `sign-in refused` / `saved, no sign-in page`, `run start`, `read`, `step done`, `run end`, `run failed`, `signed in`, from the fill routine `fill` (field and trigger) and `account` (which source decided, `live` or `at-continue`, and the verdict `same`, `other` or `none`; never an email).
- Over 256 KB at launch, it starts over. Failures to write are ignored.
