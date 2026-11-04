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

## Add an existing shoot to a campaign, from the campaign page

A campaign page lists the shoots inside it but offers no way to put one
there. The only route is to open the shoot and change its campaign.

**Why it matters.** This is the mirror of `Create a campaign from the shoot
page` above, and the two are wanted at different moments. That one serves
"these two shoots belong together, let me make a campaign". This one serves
the opposite flow: you are looking at a campaign, you can see what is in it,
and you know something is missing. Having to leave, find the shoot and edit
it from the other side is the same interruption in reverse.

**What it needs.** A picker on the campaign page, and little else —
`shoots.update` already accepts `campaignId`, and `campaign-detail.tsx`
already renders `<ShootList campaignId={...} />`, so the list refreshes for
free. `shoots.list` takes a `campaignId` filter that can source the
candidates.

**Worth deciding when picked up.** Whether a shoot that already belongs to
another campaign can be picked — which makes this "move", not "add", and
should probably say so. Offering only unassigned shoots is simpler and
likely right; a shoot in two campaigns is not expressible anyway, since
`campaign_id` is a single nullable column.

**Rough size.** Small.

---

## Change a session's date and time

A session's `starts_at` and `ends_at` are fixed at creation. Nothing in the
interface can move them afterwards.

**Why it matters.** Shoots move. Weather turns, a model reschedules, a
permit comes through for a different day — rescheduling is ordinary, not
exceptional. Today the only recourse is to delete the session and make a new
one, which throws away everything hanging off it: stops, locations, status,
and eventually the shot lists and checklists that Phases 3 and 4 will
attach. Destroying real work to change a date is the kind of thing that
teaches people not to trust the tool.

**What it needs.** Only an edit affordance. `sessions.update` already
accepts `startsAt`, `endsAt` and `timezone`, and `updateSessionSchema`
already enforces that the end follows the start — `session-list.tsx` wires
that mutation up but sends nothing except `status`. So this is a form, not a
feature.

**Worth deciding when picked up.** What happens to the timezone. Moving a
session within one place should leave it alone, but moving a shoot to
another country should not silently keep the old zone — and a session moved
across a DST boundary shifts by an hour against the wall clock while
remaining correct as an instant, which will look like a bug to whoever moved
it. Sun times are derived from the instant and follow automatically; a
weather snapshot taken for the old date does not, and should be invalidated.

**Rough size.** Small.

---

## Suggest a time for a landscape session

When a shoot is landscape type, offer the light windows as choices rather
than only describing them after the fact.

**Why it matters.** The registry already describes this genre as "outdoor
and location work where light and access decide the day", and for a
landscape shoot the light genuinely is the plan — the question is not "what
is the light at 2pm" but "when should I be there". Today `sunReport()`
computes sunrise, sunset and the golden and blue hour windows, and
`SunTimes` renders them for a session that has already been scheduled. All
the maths exists; it is pointed the wrong way round.

**What it needs.** Inverting the existing calculation: given a date and a
location, present the windows as pickable times that fill in `starts_at` and
`ends_at`, instead of making someone read the window and type the time back
in by hand. A golden-hour window is already a start and an end, so it maps
onto a session directly.

**Worth deciding when picked up.**

- Whether this is landscape-only or offered for any genre with an outdoor
  location. Portrait work chases the same light, so gating on
  `shoot_type_key` may be narrower than the actual need.
- Whether `hikeMinutes` participates. The genre already records it, and
  "golden hour starts at 06:12, so leave at 05:20" is more useful than the
  window alone — and it is arithmetic, not an integration.
- Whether `tideState` does too. The registry records a preference but
  nothing computes tides, and unlike sun times they cannot be derived
  locally — that is a provider, a key and a rate limit, so it belongs behind
  a port the way weather does.
- Which location, given a session can have several stops. That is the same
  question the `Sun times only reflect a session's first location` entry
  raises, and worth settling once for both.

**Rough size.** Small for suggesting sun windows, which is an affordance
over maths that already exists. Medium if departure time is included.
Separate and larger if tides are.

---

## Pull references in from Pinterest and elsewhere

Let a reference image arrive from a URL or a linked account, not only from
the file picker.

**Why it matters.** `assets.createUpload` is the only way an image enters
the system: the browser gets a presigned target, PUTs the file, confirms.
That assumes every reference is already a file on the device you are sitting
at, and it usually is not — references are found while browsing, and
Pinterest in particular is where a lot of photographers keep them. The
workaround is to save each image to disk and upload it, which is enough
friction that moodboards end up thinner than the planning that actually
happened.

**What it needs.**

- **A URL import path.** Fetch server-side and store the result as an
  ordinary asset, so the derivative pipeline, usage counters and moodboard
  code need no changes at all. It belongs in the worker: it is an outbound
  fetch of an unknown-sized response from an untrusted host, which is
  precisely what should not happen inside a request.
- **The usual protections on that fetch** — a size ceiling enforced while
  streaming rather than after the fact, a content-type check, a timeout and
  a redirect policy. A URL supplied by a user and then fetched by the server
  is the classic SSRF shape, so private address ranges have to be refused.
- **`workspace_usage` accounted the same way**, since an imported image
  costs exactly what an uploaded one does.

**Worth deciding when picked up.**

- **Whether a connector is needed at all.** A generic "paste an image URL",
  plus drag-and-drop of an image from another tab, may cover most of the
  value for none of the cost. Worth building that first and seeing what is
  still missing: a per-service OAuth integration is a lot of surface to
  maintain, and each one rots independently of the others.
- **What Pinterest actually permits.** Their API terms, whether board access
  requires OAuth, and whether private boards are reachable at all are the
  first things to check — the answer may make a connector not worth
  building. Scraping a public pin URL is a different thing wearing the same
  clothes and would need deciding on its own merits.
- **Copy or link.** Storing a copy survives link rot and makes the asset
  behave like every other one, but it means holding someone else's image.
  Linking avoids that and breaks silently. Copying is probably right for
  private planning; the distinction matters more if a moodboard is ever
  shared with a client.
- **Attribution.** A reference from the web has a source worth recording on
  the asset — both out of fairness and because "where did this come from" is
  a question that gets asked as soon as a client likes one.

**Rough size.** Medium for URL import, which is where most of the value is.
Large for any single OAuth connector, and recurring rather than one-off.
