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
