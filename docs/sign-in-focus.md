# sign-in-focus

**Does** — `readFocusedField`: says whether the focused input on Onshape's sign-in page is an email/username field, a password field, or something else, and whether it's empty.

**Why it exists** — The fill routine (`sign-in-fill.ts`) types only into an empty focused field of the right kind, and the password only for the saved account, so Zenshape needs to know which field has focus and whose email is on the page. A preload or any script in Onshape's page is ruled out (`docs/disclaimer.md`), so it asks Chromium's DevTools protocol instead.

**Talks to** — a `send` function: `webContents.debugger.sendCommand` from `tab-views.ts`.

**Gotchas**
- Only five protocol methods, from `ALLOWED_METHODS`: `DOM.getDocument`, `DOM.querySelector('input:focus')`, `DOM.querySelectorAll`, `DOM.getAttributes`, `Accessibility.getPartialAXTree`. Anything else is refused, `Runtime` (running code in the page) above all.
- Onshape's email field is `type=text name=username autocomplete=username`, in the main frame, and focused when the page loads (seen 2026-11-18 on the live page). So "email" also means a text field named or autocompleted as email, user or login.
- Onshape's two-factor field is `type=password name=totpCode` (seen on Windows, 2026-11-25). A password input named or autocompleted as a code (`totp`, `one-time-code`: only the forms seen) is `other`, so neither the run nor the autofill takes it for the password.
- Emptiness comes from the field's accessibility value; it's only compared with empty, never kept. A password field's value is masked there.
- `input:focus` matches only while the page has focus, which a click gives it. Seen in a test build: "email, empty" when the field was selected, "no field" when not; "password" after Continue.
- `readAccount` reads every email/username input on the page (`EMAIL_INPUT`, `DOM.querySelectorAll`), from their accessibility values, which Chromium keeps in step with typing (`DOM.getAttributes` gives only the `value` attribute, which isn't live; seen: empty to filled after `insertText`, scratch run 2026-11-18). It compares each with the saved email inside and returns `{ verdict, inputs }`: the verdict is `other` if any holds another email, `same` if one holds the saved one and none another, null with no text; `inputs` says whether the page has any such input at all. No email leaves it.
