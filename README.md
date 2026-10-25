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

## Architecture

A **modular monolith**, organised as vertical slices by bounded context, with a
hexagonal seam only at the external edges.

```
Request → oRPC procedure (authn, build TenantContext, validate)   ← thin adapter
        → core/modules/<ctx>/service.ts      ← all business rules
        → core/modules/<ctx>/repository.ts   ← Drizzle, always via withTenant()
        → Postgres (row-level security as the backstop)
```

Business logic never lives in route handlers or server actions. That is what
lets the web UI, a future mobile app and any future public API reach identical
behaviour through one path.

### Tenant isolation

Enforced in three layers, because no single one is sufficient:

1. **Schema** — every domain table carries `workspace_id`, and child tables use
   composite `(workspace_id, id)` foreign keys, so the database structurally
   rejects cross-tenant references.
2. **Application** — service code cannot obtain a bare database handle. The only
   way to query is `withTenant`, which opens a transaction and sets the
   workspace GUC that the policies read.
3. **Database** — `FORCE ROW LEVEL SECURITY` on every domain table. The
   application connects as an unprivileged role that does not own the tables, so
   policies genuinely apply to it.

A [test suite](packages/db/src/testing/tenant-isolation.test.ts) walks every
registered domain table and asserts each of these. Registering a table without a
probe is a compile error.

### Portability

No vendor primitives. Postgres and an S3-compatible bucket are the entire
infrastructure; background jobs and cron will live inside Postgres. The stack is
containerised and runs unchanged on any container host — the deployment target
is deliberately an unmade decision.

## Stack

| Concern    | Choice                                                             |
| ---------- | ------------------------------------------------------------------ |
| Monorepo   | pnpm workspaces + Turborepo                                        |
| Web        | Next.js 16 (App Router)                                            |
| API        | oRPC — one set of procedures serving a typed client _and_ OpenAPI  |
| Database   | Postgres 18 + Drizzle                                              |
| Auth       | Better Auth (self-hosted) with the organization plugin             |
| Validation | Zod 4, shared between server, web and future mobile                |
| Testing    | Vitest + Testcontainers (real Postgres, real migrations, real RLS) |

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

Starts Postgres, S3-compatible storage, the web app and the worker, and
applies migrations automatically on the way up. Open <http://localhost:3000>.

Nothing else to run. This is also the portability test: if it runs here, it
runs on any container host.

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

### Commands

| Command          | What it does                                                                                                                                                                                                      |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test`      | 49 tests against a real Postgres 18 started by Testcontainers, with real migrations and real row-level security                                                                                                   |
| `pnpm test:e2e`  | 12 Playwright tests at **mobile and desktop viewports**, against the real server, real auth and real RLS                                                                                                          |
| `pnpm db:seed`   | A demo workspace and five shoots, created **through the real service layer** — so a successful run exercises `withTenant`, the policies, the `updated_at` trigger and the idempotent create path. Safe to re-run. |
| `pnpm db:studio` | Browse the database at <https://local.drizzle.studio>                                                                                                                                                             |
| `pnpm typecheck` | Typecheck every package and app                                                                                                                                                                                   |

The most informative thing to read is
[`tenant-isolation.test.ts`](packages/db/src/testing/tenant-isolation.test.ts):
it walks every domain table and proves a workspace cannot see, modify or write
into another's data, and that a query escaping `withTenant` returns nothing
rather than everything.

## Repository layout

```
apps/
  web/        Next.js app (marketing + application)
  worker/     background jobs and cron
packages/
  core/       domain modules — services, repositories, ports
  db/         Drizzle schema, migrations, withTenant, RLS
  api/        oRPC contract and routers
  api-client/ typed client — shared with future mobile
  schemas/    Zod schemas — shared with future mobile
  ui/         React components (web only)
  config/     environment validation
```

`packages/schemas` and `packages/api-client` are kept free of Node-only imports
so a React Native app can bundle them unchanged.

## Roadmap

| Phase | Scope                                                            | Status  |
| ----- | ---------------------------------------------------------------- | ------- |
| 0     | Foundations: monorepo, auth, tenancy, RLS, one entity end to end | ✅ done |
| 1     | Campaigns, shoots, sessions, shoot-type registry                 |         |
| 2     | Assets, uploads, moodboards                                      |         |
| 3     | Shot lists, checklists, on-set mode                              |         |
| 4     | Session templates                                                |         |
| 5     | Locations, sun and weather                                       |         |
| 6     | Clients and deliverables                                         |         |

## Licence

Not yet chosen. Until a `LICENSE` file is added the default applies — all rights
reserved — so the code is readable but not licensed for reuse.
