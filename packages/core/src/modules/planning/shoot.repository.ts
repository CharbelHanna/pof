import { and, asc, eq, gt, gte, isNull, sql, type SQL } from 'drizzle-orm'
import { schema, type TenantDb } from '@pof/db'

import type { ListShootsInput } from '@pof/schemas'

/**
 * Shoot persistence.
 *
 * Every function takes a `TenantDb` — a handle obtainable only from
 * `withTenant`. That is what makes "I forgot to scope this query" a compile
 * error rather than a cross-tenant read.
 *
 * The explicit `workspaceId` predicates below are belt-and-braces: row-level
 * security already restricts these queries. Both exist because RLS is a
 * backstop for mistakes in this file, and this file is a backstop for a
 * misconfigured database role. Neither alone is sufficient.
 */

const { shoot } = schema

/** Excludes tombstones unless explicitly asked for. */
function visibility(workspaceId: string, includeDeleted: boolean): SQL | undefined {
  const scope = eq(shoot.workspaceId, workspaceId)
  return includeDeleted ? scope : and(scope, isNull(shoot.deletedAt))
}

export async function insertShoot(
  tx: TenantDb,
  workspaceId: string,
  values: {
    id?: string
    name: string
    shootTypeKey: string
    status: (typeof schema.shoot.$inferInsert)['status']
    campaignId?: string | null | undefined
    deliveryDate?: string | null | undefined
    details?: Record<string, unknown> | undefined
    detailsSchemaVersion?: number | undefined
    notes?: string | undefined
  },
) {
  const [row] = await tx
    .insert(shoot)
    .values({
      ...(values.id ? { id: values.id } : {}),
      workspaceId,
      name: values.name,
      shootTypeKey: values.shootTypeKey,
      status: values.status,
      campaignId: values.campaignId ?? null,
      deliveryDate: values.deliveryDate ?? null,
      details: values.details ?? {},
      detailsSchemaVersion: values.detailsSchemaVersion ?? 1,
      notes: values.notes ?? null,
    })
    /**
     * Idempotent create. An offline client replaying a queued mutation, or a
     * double-submitted form, must not produce a second shoot. The client mints
     * the UUIDv7 precisely so this is possible.
     */
    .onConflictDoNothing({ target: shoot.id })
    .returning()

  // `undefined` means the id already existed — the caller re-reads it so a
  // replay returns the original row rather than an error.
  return row
}

export async function findShootById(tx: TenantDb, workspaceId: string, id: string) {
  const [row] = await tx
    .select()
    .from(shoot)
    .where(and(eq(shoot.id, id), visibility(workspaceId, true)))
    .limit(1)

  return row
}

export async function listShoots(tx: TenantDb, workspaceId: string, input: ListShootsInput) {
  const predicates: (SQL | undefined)[] = [visibility(workspaceId, input.includeDeleted)]

  if (input.campaignId) {
    // `'none'` means "not in any campaign" — a real question, and distinct
    // from "no filter applied". See campaignFilterSchema.
    predicates.push(
      input.campaignId === 'none'
        ? isNull(shoot.campaignId)
        : eq(shoot.campaignId, input.campaignId),
    )
  }

  // Keyset pagination, never OFFSET: deep offsets degrade badly once a
  // workspace has real history. Ordering by the v7 primary key works because
  // v7 is time-ordered, so it doubles as a stable creation-order cursor
  // without a second column.
  if (input.cursor) predicates.push(gt(shoot.id, input.cursor))

  // Incremental sync. Tombstones are included deliberately when the caller
  // asks, so an offline client learns what to drop locally.
  if (input.updatedSince) predicates.push(gte(shoot.updatedAt, input.updatedSince))

  const rows = await tx
    .select()
    .from(shoot)
    .where(and(...predicates))
    .orderBy(asc(shoot.id))
    .limit(input.limit + 1)

  /**
   * The database's own clock, read inside this same transaction.
   *
   * Clients must echo this back as the next `updatedSince` rather than using
   * their own `new Date()`. Row timestamps are written by the database, so a
   * client-generated cutoff is compared against a different clock — and any
   * skew silently drops rows from the sync window instead of failing loudly.
   * (The skew is real and routinely milliseconds-to-seconds between a host
   * and a container, or a phone and a server.)
   *
   * `transaction_timestamp()` rather than `clock_timestamp()`: it is fixed for
   * the whole transaction, so it cannot land *after* a row this query did not
   * see, which would leave a permanent hole in the client's data.
   */
  // Note: raw `execute` returns driver strings, not Dates. Drizzle turns off
  // postgres-js's own type parsing so it can map column types itself, and
  // that mapping does not apply to raw SQL — so coerce explicitly rather than
  // trusting the generic parameter.
  const [clock] = await tx.execute<{ now: string }>(sql`select transaction_timestamp() as now`)

  // Fetch one extra to determine whether another page exists, without a
  // second COUNT query.
  const hasMore = rows.length > input.limit
  const page = hasMore ? rows.slice(0, input.limit) : rows

  return {
    items: page,
    nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
    syncedAt: new Date(clock!.now),
  }
}

export async function updateShoot(
  tx: TenantDb,
  workspaceId: string,
  id: string,
  patch: Record<string, unknown>,
) {
  const [row] = await tx
    .update(shoot)
    .set(patch)
    .where(and(eq(shoot.id, id), visibility(workspaceId, false)))
    .returning()

  return row
}

/**
 * Soft delete. User-authored rows are never hard-deleted by normal flows — a
 * deleted row still has to be reported to offline clients as a tombstone.
 * Hard deletion happens only via the GDPR erase job (Phase 7).
 */
export async function softDeleteShoot(tx: TenantDb, workspaceId: string, id: string) {
  const [row] = await tx
    .update(shoot)
    .set({ deletedAt: new Date() })
    .where(and(eq(shoot.id, id), visibility(workspaceId, false)))
    .returning()

  return row
}
