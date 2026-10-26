# Backlog

Work that is wanted but not scheduled. The committed plan lives in the
[roadmap](README.md#roadmap); this file is everything else, so items here do not
imply a phase or a date.

When an item is picked up, move it into the roadmap or open an issue for it.

---

## Password reset

Let a photographer who has forgotten their password regain access without
contacting anyone.

**Why it matters.** Email and password is currently the only way in, so a
forgotten password means a permanently lost account and every shoot in it.
There is no admin recovery path either.

**What it needs.**

Better Auth already implements the flow (`forgetPassword` / `resetPassword`
endpoints and a `sendResetPassword` callback), so the authentication logic is
not the work. The real dependency is **being able to send email at all**:

- `MAIL_PROVIDER` currently defaults to `console`, which discards mail. The env
  schema already rejects that for a deployed app, so nothing is silently broken
  in production — but nothing can be sent either.
- The `MailPort` described in the architecture is **not implemented yet**; only
  `StoragePort` exists. It needs the port plus two adapters: SMTP (the
  self-host escape hatch, and what local development should use) and Resend.
- Local development needs a mail catcher — a `mailpit` service in
  `docker-compose.yml` — so reset links can be exercised without a real
  provider and without the e2e suite depending on the internet.
- Two pages: request a reset, and set a new password from the token.

**Worth deciding when picked up.**

- Whether to enable email verification on signup at the same time. It shares
  all of the same infrastructure, and turning it on later invalidates the
  assumption that every existing account has a reachable address.
- Rate limiting on the request endpoint, so it cannot be used to enumerate
  which email addresses have accounts, or to mail-bomb someone.

**Rough size.** Small once mail exists; most of the cost is the mail
infrastructure, which is a prerequisite for deliverable reminders in Phase 6
anyway.

---

## Boudoir shoot type

Add boudoir as a genre, alongside portrait, editorial, landscape and product.

_(Spelling: the photography term is **boudoir** — the French noun. "Boudoire"
is not a word, and the key is user-visible in URLs and the API, so it is worth
getting right once rather than migrating later.)_

**The mechanical part is genuinely small.** This is exactly what the Phase 1
shoot-type registry was built for: a row in `shoot_type` and a definition in
`packages/schemas/src/shoot-types/registry.ts`. No migration, no component
change, no deploy coupling — the form renders whatever the registry describes,
and the registry-integrity test covers the new entry automatically.

Candidate genre fields, in the same spirit as the others (trivia nothing
queries — anything cross-genre belongs in a real column):

- wardrobe notes
- hair and makeup artist
- location type — studio, hotel, client's home
- whether a chaperone or support person will be present

**The part worth thinking about before building it.**

Boudoir is not simply "portrait with different fields". It carries privacy,
consent and safeguarding expectations the product currently has no concept of:

- **Image usage consent is a legal matter, not a note.** A client may agree to
  a private gallery only, to portfolio use with per-image approval, or to a
  full release — and that decision needs to be recorded, dated, and hard to
  change silently. A free-text field inside `details` jsonb is the wrong home
  for something that may need to be produced as evidence.
- **Confidentiality cuts across features that do not exist yet.** Moodboards
  (Phase 2) and any future client sharing would need a notion of "this shoot
  is private" that currently has no representation anywhere.
- **It affects defaults, not just fields.** A boudoir shoot probably should
  not inherit the same sharing or portfolio-use defaults as a product shoot.

So the honest sizing is: **adding the genre is an afternoon; doing it
responsibly surfaces a consent/privacy model the application does not have.**
Those can be separated — ship the genre first and treat consent as its own
item — but shipping the genre while implying the app handles consent would be
worse than not having it.

Worth deciding when picked up: whether consent becomes a first-class concept
with its own table and audit trail (likely the right answer, and useful for
model releases in every genre), or stays out of scope with the limitation
stated plainly in the UI.
