# Point of Focus

Photoshoot planning for photographers.

Point of Focus helps photographers **prepare** a shoot — not deliver or sell the
images, but plan everything that has to be right before the shutter opens. It is
built for multiple genres: portrait, editorial, landscape and product work all
have different needs, and the data model is designed so adding a genre is a
configuration change rather than a migration.

> **Status: early development.** Phase 0 is complete — you can sign up, create
> shoots and they persist, with tenant isolation enforced end to end. The
> features that make it genuinely useful start at Phase 1. See
> [Roadmap](#roadmap).

## The idea

A photographer registers a **campaign** or a standalone **shoot**. A shoot has a
name, type, location, delivery date and one or more **sessions**. Around those
sit shot lists, gear checklists, moodboards, locations and deliverables.

The differentiator is **session templates**: reusable prep blueprints that turn a
recurring kind of shoot into a one-click setup. Applying a template copies its
items into the session and records where each came from, so editing a template
later never rewrites the history of a shoot you have already done — but future
sessions can be offered the diff.

## Getting started

Requires Node 20.9+ (Node 26 recommended), pnpm, and Docker Desktop running.

```bash
pnpm install
cp .env.example .env
```

There are **two ways to run it**. Pick one — they are alternatives, not steps.

#### A. Everything in containers (simplest)

```bash
docker compose up -d --build
```

Starts Postgres, S3-compatible storage, the web app and the worker, and applies
migrations automatically on the way up. Open <http://localhost:3000>.

Nothing else to run. This is also the portability test: if it runs here, it runs
on any container host.

#### B. App on the host, infrastructure in containers (for development)

Gives you hot reload and faster iteration.

```bash
docker compose up -d postgres storage   # infrastructure only
pnpm db:migrate                         # apply migrations yourself
pnpm dev                                # web + worker, with hot reload
```

Either way: sign up, create a shoot, reload — it persists. Your workspace is
provisioned automatically on first request.

Optionally seed demo data (a workspace and five shoots across genres):

```bash
pnpm db:seed
```

> **Port already in use?** Set `WEB_PORT=4000` in `.env` — it drives both the
> published port and `APP_URL`. Don't edit `docker-compose.yml`.

## Commands

| Command          | What it does                                                                                                                                                                                                      |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test`      | 49 tests against a real Postgres 18 started by Testcontainers, with real migrations and real row-level security                                                                                                   |
| `pnpm test:e2e`  | 12 Playwright tests at **mobile and desktop viewports**, against the real server, real auth and real RLS                                                                                                          |
| `pnpm db:seed`   | A demo workspace and five shoots, created **through the real service layer** — so a successful run exercises `withTenant`, the policies, the `updated_at` trigger and the idempotent create path. Safe to re-run. |
| `pnpm db:studio` | Browse the database at <https://local.drizzle.studio>                                                                                                                                                             |
| `pnpm typecheck` | Typecheck every package and app                                                                                                                                                                                   |

## Architecture

See **[ARCHITECTURE.md](ARCHITECTURE.md)** for how the system is put together:
the modular-monolith shape, the
[data model](ARCHITECTURE.md#data-model) as an entity diagram, the three layers
of tenant isolation, the portability constraints, the technology choices and
the repository layout.

The most informative single file is
[`tenant-isolation.test.ts`](packages/db/src/testing/tenant-isolation.test.ts):
it walks every domain table and proves a workspace cannot see, modify or write
into another's data, and that a query escaping `withTenant` returns nothing
rather than everything.

## Roadmap

| Phase | Scope                                                            | Status  |
| ----- | ---------------------------------------------------------------- | ------- |
| 0     | Foundations: monorepo, auth, tenancy, RLS, one entity end to end | ✅ done |
| 1     | Campaigns, shoots, sessions, shoot-type registry                 | ✅ done |
| 2     | Assets, uploads, moodboards                                      |         |
| 3     | Shot lists, checklists, on-set mode                              |         |
| 4     | Session templates                                                |         |
| 5     | Locations, sun and weather                                       |         |
| 6     | Clients and deliverables                                         |         |

Wanted but not scheduled: see [BACKLOG.md](BACKLOG.md).

## Licence

Not yet chosen. Until a `LICENSE` file is added the default applies — all rights
reserved — so the code is readable but not licensed for reuse.
