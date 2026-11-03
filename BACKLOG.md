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

---

## Trip dates, and what "delivery date" assumes

`shoot.delivery_date` is a single date meaning "when the edit is due with the
client". That assumes a client and a deliverable, which a landscape shoot
often has neither of — it is a trip, spanning days, across several locations,
possibly with nothing owed to anyone at the end.

The field is already optional, so nothing breaks today. The problem is that
the vocabulary is wrong for a whole genre, and a field whose label does not
match what you are doing invites being used for something it does not mean.

**Three ways to fix it, in rough order of preference.**

1. **Derive the span from sessions.** Sessions already carry `starts_at` and
   `ends_at`, so a shoot's date range is `min(starts_at)` to `max(ends_at)`
   without storing anything new. A multi-day trip is already expressible as
   several sessions, which is also how each day gets its own location and
   call time. This is probably right, and the cheapest.
2. **Add explicit `starts_on` / `ends_on` columns to shoot.** Useful when a
   trip is booked before any session is planned — "Iceland, second week of
   March" long before the days are worked out. Costs a migration and
   introduces two sources of truth for the same span, which have to be kept
   from disagreeing.
3. **Leave the column, relabel per genre.** The registry already varies
   fields by genre, so landscape could present trip dates while portrait
   presents a delivery date. Cheapest in code, but it would mean one column
   storing two different meanings — exactly the ambiguity worth avoiding.

Worth settling alongside the Gantt view below, which needs a date range per
shoot and so forces the same question.

---

## Calendar view

A month grid of planned sessions, alongside the existing agenda.

The agenda is a chronological list and answers "what is next". A calendar
answers a different question — "how busy is March, and where are the gaps" —
which a list cannot show at a glance.

Reuses the existing `sessions.list` endpoint, which already accepts `from`
and `until`. Mostly presentation work.

**Worth deciding when picked up.** Which timezone a month grid is drawn in.
Sessions are stored as instants plus the zone they happen in, and a session
at 23:00 in Sydney belongs to a different calendar day depending on whether
the grid is drawn in the viewer's zone or the session's. The agenda already
groups by the session's own zone; a grid should probably match, but it is
worth being deliberate rather than letting it fall out of the implementation.

---

## Gantt view

Shoots and their sessions on a timeline, so overlapping commitments and free
weeks are visible at a glance.

Depends on a shoot having a date RANGE rather than a single date — see the
trip dates item above. Until that is settled, a Gantt chart has nothing
meaningful to draw a bar between.

Most useful once campaigns group several shoots: the bar chart of a campaign
against its shoots is the view that shows whether a month is overcommitted.

---

## Map of a shoot's locations

Show a shoot's locations on a map, and later export them.

**Depends on location search**, above — a map needs coordinates, and the same
entry explains why those have to come from a geocoding search rather than a
text field.

Most valuable for landscape and any multi-location trip, where the plan is
partly a route: which locations, in what order, how far apart, and whether
the drive between them fits inside the light.

**On export.** "A custom Google map" is the obvious destination, but the
portable form is **KML or GPX** — both import into Google My Maps, and also
into Gaia, OsmAnd, a Garmin, and most things a photographer already carries.
Exporting the open format keeps Google as one target rather than the only
one, which matches how storage and weather are handled elsewhere.

Display itself needs no Google dependency: MapLibre GL with a tile URL from
configuration, as already planned for Phase 5.
