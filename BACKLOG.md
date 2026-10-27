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

## Location search with real coordinates

Attach a location to a shoot, chosen through a place search rather than typed
as free text.

**Planned for Phase 5**, together with sun and weather. Recording the specific
requirement here because it changes what Phase 5 can deliver:

**Coordinates are not a nice-to-have — they are the whole feature.** Golden
hour, blue hour and sunrise/sunset are computed from latitude, longitude and
date. A free-text address like "Glen Coe" cannot produce any of them. So the
location field has to resolve to real coordinates at the point of entry, which
means a geocoding search rather than a text box.

This matters most for landscape work, where the light window _is_ the plan, but
it applies to any outdoor session.

**Worth deciding when picked up.**

- Which geocoding provider, and under what licence. The same trap as weather:
  several are free for non-commercial use only. Nominatim (OpenStreetMap) is
  free with a usage policy; Photon and MapTiler are alternatives. It belongs
  behind a port like `WeatherPort`, so the choice is reversible.
- Coordinates should be stored on the shoot and session regardless of which
  provider found them, so the sun calculation never depends on a third party
  being reachable. SunCalc runs locally with no API at all.
- Locations are worth reusing — a photographer returns to the same places —
  which is why the plan already has a `location` table rather than a column.
