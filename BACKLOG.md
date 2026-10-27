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

---

## Crew on a shoot

Record who is working a shoot — a count and the roles. "Crew: 2 — main
photographer and assistant."

Nothing covers this today. Shots, gear and sessions are all planned, but the
people are not, even though crew size drives call times, how many hands are
available for lighting, and what a client is being billed for.

**Open questions worth settling before building it.**

- **Per shoot or per session?** An assistant might come to the studio day but
  not the rooftop golden hour. The existing checklist tables already use
  `shoot_id NOT NULL, session_id NULL` for exactly this "either level" shape,
  and crew likely wants the same.
- **Free text or linked people?** "Assistant" as a label is enough to plan
  with. A named, reusable person starts to overlap with the contacts model in
  Phase 6, and the two should not end up as parallel half-implementations of
  the same idea.
- Roles are probably a seeded reference list — photographer, assistant, hair
  and makeup, stylist, producer, digitech — following the same
  table-not-enum approach as shoot types, so adding one is an INSERT.

---

## Gear on a shoot

Identify the kit to prepare, so nothing is discovered missing on location.

**Partly planned already.** Phase 3 covers gear checklists, and the schema is
designed for them: a `checklist` with `kind` of `gear`, hanging off a shoot
with an optional session, so a kit can be per-shoot ("everything I'm
bringing") or per-session.

**What this adds to that plan** is the distinction between a checklist and a
gear _library_:

- A checklist is free text — fine for one shoot, retyped for every shoot
  after it.
- A library of owned kit, with items selected into a shoot, means "my 85mm"
  is one thing that can be reused, counted, and eventually tracked when it is
  out on a job or being repaired.

The second is more useful and only slightly more work, but it is a different
data model and worth deciding deliberately rather than discovering after the
free-text version ships.

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
