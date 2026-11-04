# Backlog

Work that is wanted but not scheduled. The committed plan lives in the
[roadmap](README.md#roadmap); this file is everything else, so items here do not
imply a phase or a date.

When an item is picked up, move it into the roadmap or open an issue for it.

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

---

## Crew and gear at the session level

Let a photographer say that an assistant is only coming to the studio day, or
that the 85mm is only needed for the rooftop session.

**Why it matters.** Crew size drives call times and what a client is billed
for, and a kit list that cannot distinguish "in the bag all day" from "only
for the second location" is the kind of plan people stop trusting and go back
to a notes app for.

**What it needs.** The two halves are not the same size, which is the useful
part of this entry:

- **Crew is already modelled.** `crew_member.session_id` exists and is
  nullable, with a composite foreign key ensuring the session belongs to the
  same shoot. Only the UI never exposes it, so every crew member is implicitly
  whole-shoot. This is a form change, not a migration.
- **Gear is not.** `shoot_gear` has `shoot_id` only. Session scoping needs a
  nullable `session_id`, the same composite foreign key, and a migration.

**Worth deciding when picked up.** Whether `packed` still makes sense per
session. Packing happens once for the day, so a per-session row that is
"packed" may be a category error — see the reasoning on
`shot_gear_requirement`, which deliberately has no `packed` for that reason.

**Rough size.** Small for crew, small-to-medium for gear.

---

## Create a campaign from the shoot page

Offer "new campaign" inline in the campaign selector on a shoot, instead of
making someone leave, create it, and come back.

**Why it matters.** Campaigns are discovered mid-flow: you create the second
shoot for a client and only then realise the two belong together. Today that
means abandoning the page you are on.

**What it needs.** An inline create in the selector, reusing
`campaigns.create`, then selecting the new campaign without a navigation. The
mutation already exists; this is a UI affordance.

**Rough size.** Small.

---

## Save a location without searching for it

Let someone type a name and an address directly — "My Studio" → "12 Example
Street" — rather than only picking from geocoder results.

**Why it matters.** `location-picker.tsx` only creates a location from a
search result, so anywhere the geocoder does not know cannot be saved at all:
a private studio, a client's house, a field with a gate reference. These are
exactly the places a photographer returns to most.

**What it needs.** A manual entry path alongside search. Coordinates are the
open question, since sun times depend on them — either optional (and sun times
degrade), or entered by hand, or taken from a map pin once Phase 5's map
lands.

**Worth deciding when picked up.** Whether a manual location without
coordinates is allowed at all, given `latitude`/`longitude` are currently
`NOT NULL`.

**Rough size.** Small, unless coordinates become optional — that is a
migration and a change to every sun-time call site.

---

## Tags

Free-form labels across shoots and locations: `indoor`, `outdoor`, `seaside`,
`mountain`, `newborn`, `family`.

**Why it matters.** The genre registry answers "what kind of shoot is this",
but not the cross-cutting questions people actually search on — every seaside
location, every newborn session. Those cut across genres and will never be a
fixed list.

**What it needs.** A `tag` table plus join tables, or a denormalised text
array with a GIN index. Worth noting the precedent already set for free text
(`crew_member.role`, `gear_item.category`, `shot.framing`): nothing branches
on these values, so they should not become a reference table requiring a
migration per new word.

**Worth deciding when picked up.** Whether tags are per-workspace or global,
and whether they are typed (location tags vs shoot tags) or one shared
vocabulary.

**Rough size.** Medium — the schema is easy, the filtering UI is the work.

---

## Colours render differently on Android and iOS

The palette does not look the same in Android's default browser as it does on
an iPhone.

**Why it matters.** The accent is described in `globals.css` as "golden hour,
the product's emotional centre". A palette that shifts between the two phones
most clients hold undermines that, and it is invisible from a desktop.

**What it needs.** Investigation before a fix. The likely cause is the palette
being authored in `oklch()`: browsers differ in whether they clamp
out-of-sRGB-gamut colours or map them into the display's P3 gamut, and the
accent is saturated enough to sit near that boundary. Candidates:

- Add sRGB fallbacks alongside each `oklch()` declaration.
- Pull the accent chroma inside the sRGB gamut so there is nothing to clamp.
- Confirm first with a real device or BrowserStack; a desktop emulator will
  not reproduce a gamut difference.

**Rough size.** Unknown until reproduced. The fix is probably small; the
reproduction is the work.

---

## Email verification on sign-up

Confirm an address belongs to the person who entered it before the account is
fully usable.

**Why it matters.** `requireEmailVerification` is `false`, so a typo in an
address creates a working account that can never receive a password reset —
which, now that reset exists, is the one thing that makes an account
unrecoverable.

**What it needs.** The mail infrastructure already exists (`MailPort`, three
adapters, Mailpit locally), so this is Better Auth configuration plus a
verification page and a "resend" path.

**Worth deciding when picked up.** Whether verification blocks use or merely
nags. Blocking is safer; it also means an unverified user cannot plan the
shoot they just signed up to plan. Also: every existing account predates this
and has no verified address.

**Rough size.** Small.

---

## The shoot page does not separate shoot scope from session scope

It is not visually clear which things belong to the shoot as a whole and which
belong to one session.

**Why it matters.** The distinction is real and load-bearing — shots, crew and
gear all attach at either level, with a nullable `session_id` meaning "the
whole shoot". If the page does not express that, people cannot tell what they
are editing, and the flexibility reads as inconsistency instead.

**What it needs.** A layout change rather than a data change: group
shoot-level sections distinctly from per-session ones, and label scope where
something can be either. Related to the crew-and-gear entry above, which adds
a second thing that can sit at both levels.

**Rough size.** Medium. Mostly design.

---

## Sun times only reflect a session's first location

A session with several stops shows light conditions for the first one only.

**Why it matters.** Sessions became routes when `session_location` landed, and
a route exists precisely because the stops differ. Showing one set of times
for all of them is wrong in exactly the case the feature was built for — a
layby, a lochside and a ridge do not share a horizon.

**What it needs.** `session-stops.tsx` currently takes `stops[0]` as the
primary and renders a single `SunTimes`. Options:

- Sun times per stop, inline in the route list.
- One set of times, but centred on the stop whose scheduled time matches.
- Keep the primary as the headline and let a stop be expanded.

**Worth deciding when picked up.** Whether every stop should have its own
time window, which is the `trip dates` entry's territory and probably wants
solving together.

**Rough size.** Small for per-stop times; medium if stops gain their own
times.

---

## Show which version is running

Surface a build identifier in the application, so a bug report can say what
it was running.

**Why it matters.** Every package is `0.0.0`, there are no git tags, and
nothing in the UI or the API says what build is live. When a photographer
reports that something broke on their phone, there is currently no way to
tell whether they are on today's deploy or a page their browser cached last
week — and that is the first question worth answering, because it decides
whether to debug the code or tell them to reload.

It also matters for the one thing this app cannot easily reproduce: a bug
that only appears on a real device. Without a version, two reports of
"uploads fail" cannot be told apart.

**What it needs.**

- **A source of truth.** The monorepo's `version` fields are all `0.0.0` and
  the packages are `private`, so bumping them means nothing to npm and would
  be pure ceremony. The short git SHA is the honest identifier; a tag on top
  of it is nicer to say out loud. Both, probably: `v0.3.1+a1b2c3d`.
- **Getting it into the image.** `.git` is excluded by `.dockerignore`, so
  the build cannot read the SHA itself. It has to arrive as a build argument
  — `--build-arg GIT_SHA=$(git rev-parse --short HEAD)` — which also means
  CI must pass it, and a local `docker compose build` will need a sensible
  fallback rather than printing `unknown`.
- **Getting it to the browser.** Next.js inlines `NEXT_PUBLIC_*` at build
  time, which is exactly right here: the value is fixed for the life of the
  image and should not be a runtime lookup.
- **Somewhere to show it.** Small and out of the way — the footer, or beside
  the signed-in account in the header. Not a dialog.
- **The API too.** A `/health` or `/version` response carrying the same
  identifier is what makes "which version is the server on" answerable
  without a browser, and lets a deploy be verified rather than assumed.

**Worth deciding when picked up.**

- Whether the worker reports its own version separately. It is a different
  image and can genuinely be a different build — which is precisely the kind
  of skew that produces a confusing bug report.
- Whether to show the build date as well. "Three weeks old" is more
  actionable to most people than a SHA.

**Rough size.** Small. The only fiddly part is the build argument reaching
every path that builds an image — compose, CI, and any future deploy.
