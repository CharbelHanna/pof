import { randomUUID } from 'node:crypto'

import { and, eq, getTableName, sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createDatabase, type Database } from '../client.ts'
import { organization } from '../schema/auth.ts'
import { tenantTables, type TenantTableName } from '../schema/index.ts'
import { withTenant } from '../tenant.ts'
import { testDatabaseUrls } from './index.ts'
import { tenantSeeds } from './seeds.ts'

/**
 * ===========================================================================
 * Tenant isolation.
 * ===========================================================================
 *
 * This suite is the reason the three-layer tenancy design can be trusted. It
 * walks EVERY registered domain table rather than spot-checking one, so a new
 * table is covered the moment it is registered — and `tenantSeeds` makes
 * registering a table without a probe a compile error.
 *
 * It connects as `pof_app`, the same unprivileged role the application uses,
 * because that is the only configuration whose behaviour we actually care
 * about. Running these assertions as the owner would pass trivially and prove
 * nothing.
 */

let db: Database
let close: () => Promise<void>

/**
 * Drizzle wraps driver errors ("Failed query: ..."), so the interesting
 * message — the one naming the RLS policy — hangs off `cause`. Asserting on
 * the top-level message alone silently passes for the wrong reason.
 */
function describeError(error: unknown): string {
  const seen: string[] = []
  let current: unknown = error
  while (current instanceof Error) {
    seen.push(current.message)
    current = current.cause
  }
  return seen.join(' | ')
}

/** Two workspaces, per table, so parallel suites never collide. */
const workspaceA = new Map<string, string>()
const workspaceB = new Map<string, string>()

const tableEntries = Object.entries(tenantTables) as [
  TenantTableName,
  (typeof tenantTables)[TenantTableName],
][]

beforeAll(async () => {
  const created = createDatabase(testDatabaseUrls().appUrl, { max: 5 })
  db = created.db
  close = async () => {
    await created.client.end({ timeout: 5 })
  }

  // Workspaces live in `organization`, which has no RLS (auth must resolve a
  // user's orgs before any workspace context exists), so these inserts need no
  // tenant scope.
  for (const [name] of tableEntries) {
    const a = randomUUID()
    const b = randomUUID()
    workspaceA.set(name, a)
    workspaceB.set(name, b)

    await db.insert(organization).values([
      { id: a, name: `A:${name}`, slug: `a-${name}-${a.slice(0, 8)}` },
      { id: b, name: `B:${name}`, slug: `b-${name}-${b.slice(0, 8)}` },
    ])
  }
})

afterAll(async () => {
  await close?.()
})

describe('the application connects as a role RLS actually applies to', () => {
  it('is not a superuser', async () => {
    const [row] = await db.execute<{ rolsuper: boolean }>(
      sql`select rolsuper from pg_roles where rolname = current_user`,
    )
    // A superuser bypasses RLS unconditionally. If this ever flips, every
    // other assertion in this file becomes meaningless.
    expect(row?.rolsuper).toBe(false)
  })

  it('does not own the domain tables', async () => {
    for (const [, table] of tableEntries) {
      const [row] = await db.execute<{ owner: string; current: string }>(sql`
        select tableowner as owner, current_user as current
        from pg_tables
        where schemaname = 'public' and tablename = ${getTableName(table)}
      `)
      // Without FORCE ROW LEVEL SECURITY an owner silently bypasses its own
      // policies. We set FORCE as well, but connecting as a non-owner is the
      // primary defence and worth asserting outright.
      expect(row?.owner).not.toBe(row?.current)
    }
  })
})

/**
 * The column that identifies a row within a workspace.
 *
 * Almost every tenant table has `id`. `workspace_usage` does not — it holds
 * exactly one row per workspace, keyed by `workspace_id` — and this suite
 * has to cover it rather than skip it, because "every tenant table is
 * isolated" is the guarantee the file exists to make. Skipping the awkward
 * shape would quietly narrow that to "every table shaped the way we
 * expected".
 */
function rowKey(table: (typeof tableEntries)[number][1]): AnyPgColumn {
  return ('id' in table ? table.id : table.workspaceId) as AnyPgColumn
}

describe.each(tableEntries)('%s is isolated per workspace', (name, table) => {
  const a = () => workspaceA.get(name)!
  const b = () => workspaceB.get(name)!
  const ctx = (workspaceId: string) => ({ workspaceId, userId: randomUUID() })
  const seed = tenantSeeds[name]

  let rowA: string
  let rowB: string

  beforeAll(async () => {
    const [insertedA] = await withTenant(db, ctx(a()), async (tx) =>
      tx
        .insert(table)
        .values((await seed(a(), tx)) as never)
        .returning({ id: rowKey(table) }),
    )
    const [insertedB] = await withTenant(db, ctx(b()), async (tx) =>
      tx
        .insert(table)
        .values((await seed(b(), tx)) as never)
        .returning({ id: rowKey(table) }),
    )

    // `rowKey` erases the column's literal type, so the returned value
    // widens to unknown. Both keys are uuids either way.
    rowA = insertedA!.id as string
    rowB = insertedB!.id as string
  })

  it('shows a workspace only its own rows', async () => {
    const visible = await withTenant(db, ctx(a()), (tx) =>
      tx.select({ id: rowKey(table) }).from(table),
    )

    expect(visible.map((row) => row.id)).toContain(rowA)
    expect(visible.map((row) => row.id)).not.toContain(rowB)
  })

  it('hides another workspace row even when its id is known', async () => {
    // The realistic attack: an id leaks (a URL, a log line, a shared
    // screenshot) and is replayed under a different workspace.
    const found = await withTenant(db, ctx(a()), (tx) =>
      tx
        .select({ id: rowKey(table) })
        .from(table)
        .where(eq(rowKey(table), rowB)),
    )

    expect(found).toHaveLength(0)
  })

  it('refuses to update another workspace row', async () => {
    const updated = await withTenant(db, ctx(a()), (tx) =>
      tx
        .update(table)
        .set({ updatedAt: new Date() } as never)
        .where(eq(rowKey(table), rowB))
        .returning({ id: rowKey(table) }),
    )

    expect(updated).toHaveLength(0)
  })

  it('refuses to delete another workspace row', async () => {
    const deleted = await withTenant(db, ctx(a()), (tx) =>
      tx
        .delete(table)
        .where(eq(rowKey(table), rowB))
        .returning({ id: rowKey(table) }),
    )

    expect(deleted).toHaveLength(0)

    // And B still has it.
    const stillThere = await withTenant(db, ctx(b()), (tx) =>
      tx
        .select({ id: rowKey(table) })
        .from(table)
        .where(eq(rowKey(table), rowB)),
    )
    expect(stillThere).toHaveLength(1)
  })

  it('refuses to write a row into another workspace', async () => {
    // WITH CHECK, not just USING. Without it a tenant could insert rows into a
    // workspace it cannot read — invisible to them, corrupting for the victim.
    //
    // B's values are prepared in B's OWN context first. Building them inside
    // A's transaction would trip the policy on a prerequisite row (a session
    // needs a parent shoot), so the test would pass for the wrong reason and
    // never exercise the insert it names.
    const foreignValues = await withTenant(db, ctx(b()), (tx) => seed(b(), tx))

    const error = await withTenant(db, ctx(a()), (tx) =>
      tx.insert(table).values(foreignValues as never),
    ).then(
      () => null,
      (caught: unknown) => caught,
    )

    expect(error).toBeInstanceOf(Error)
    expect(describeError(error)).toMatch(/row-level security/i)
  })

  it('returns nothing at all when the query escapes withTenant', async () => {
    // The whole point of layer 3. A query that forgets tenant scoping — raw
    // SQL for a report, a repository helper that skipped the context — must
    // fail CLOSED. current_setting(..., true) yields NULL when unset, so the
    // policy matches zero rows rather than every row.
    const leaked = await db.select({ id: rowKey(table) }).from(table)

    expect(leaked).toHaveLength(0)
  })
})
