import { and, asc, eq, gt, gte, isNull, max, sql, type SQL } from 'drizzle-orm'
import { schema, withTenant, type Database, type TenantContext, type TenantDb } from '@pof/db'
import type {
  AddSessionLocationInput,
  ListSessionLocationsInput,
  ReorderSessionLocationsInput,
  UpdateSessionLocationInput,
} from '@pof/schemas'

import { NotFoundError, ValidationError } from '../../errors.ts'

/**
 * The places a session visits, in the order it visits them.
 *
 * Replaces the single `shoot_session.location_id`, which could hold one stop
 * and so pushed the rest of a route into free text. The lowest `position` is
 * the primary location — what sun times and a map centre on when one answer
 * is needed.
 */

const { location, sessionLocation, shootSession } = schema

/** Leaves room to insert between two stops without renumbering. */
const POSITION_STEP = 10

function visibility(workspaceId: string, includeDeleted: boolean): SQL | undefined {
  const scope = eq(sessionLocation.workspaceId, workspaceId)
  return includeDeleted ? scope : and(scope, isNull(sessionLocation.deletedAt))
}

/**
 * The composite foreign keys already make a cross-workspace reference
 * impossible, but a constraint violation reaches the user as an opaque 500.
 * Checking first turns it into a clean "not found".
 */
async function assertSessionUsable(tx: TenantDb, workspaceId: string, sessionId: string) {
  const [parent] = await tx
    .select({ id: shootSession.id })
    .from(shootSession)
    .where(
      and(
        eq(shootSession.id, sessionId),
        eq(shootSession.workspaceId, workspaceId),
        isNull(shootSession.deletedAt),
      ),
    )
    .limit(1)

  if (!parent) throw new NotFoundError('Session', sessionId)
}

/** Appends to the end of the session's route. */
async function nextPosition(tx: TenantDb, workspaceId: string, sessionId: string): Promise<number> {
  const [row] = await tx
    .select({ highest: max(sessionLocation.position) })
    .from(sessionLocation)
    .where(and(eq(sessionLocation.sessionId, sessionId), visibility(workspaceId, true)))

  return (row?.highest ?? -POSITION_STEP) + POSITION_STEP
}

export async function addSessionLocation(
  db: Database,
  ctx: TenantContext,
  input: AddSessionLocationInput,
) {
  return withTenant(db, ctx, async (tx) => {
    await assertSessionUsable(tx, ctx.workspaceId, input.sessionId)

    const [place] = await tx
      .select({ id: location.id })
      .from(location)
      .where(
        and(
          eq(location.id, input.locationId),
          eq(location.workspaceId, ctx.workspaceId),
          isNull(location.deletedAt),
        ),
      )
      .limit(1)
    if (!place) throw new NotFoundError('Location', input.locationId)

    const [row] = await tx
      .insert(sessionLocation)
      .values({
        ...(input.id ? { id: input.id } : {}),
        workspaceId: ctx.workspaceId,
        sessionId: input.sessionId,
        locationId: input.locationId,
        position: input.position ?? (await nextPosition(tx, ctx.workspaceId, input.sessionId)),
        notes: input.notes ?? null,
      })
      /**
       * Adding the same place twice is someone clicking again, not an error.
       * Revisiting a location within one session is expressed by ordering,
       * not by a second row.
       */
      .onConflictDoNothing({
        target: [
          sessionLocation.workspaceId,
          sessionLocation.sessionId,
          sessionLocation.locationId,
        ],
      })
      .returning()

    if (row) return row

    const [existing] = await tx
      .select()
      .from(sessionLocation)
      .where(
        and(
          eq(sessionLocation.sessionId, input.sessionId),
          eq(sessionLocation.locationId, input.locationId),
          visibility(ctx.workspaceId, true),
        ),
      )
      .limit(1)

    if (!existing) throw new NotFoundError('Session location', input.locationId)
    return existing
  })
}

export async function listSessionLocations(
  db: Database,
  ctx: TenantContext,
  input: ListSessionLocationsInput,
) {
  return withTenant(db, ctx, async (tx) => {
    const predicates: (SQL | undefined)[] = [visibility(ctx.workspaceId, input.includeDeleted)]

    if (input.sessionId) predicates.push(eq(sessionLocation.sessionId, input.sessionId))
    if (input.updatedSince) predicates.push(gte(sessionLocation.updatedAt, input.updatedSince))
    if (input.cursor) predicates.push(gt(sessionLocation.id, input.cursor))

    const rows = await tx
      .select()
      .from(sessionLocation)
      .where(and(...predicates))
      /**
       * Keyset pagination needs a unique, stable sort, and `position` is
       * neither — it repeats across sessions and changes on reorder. Callers
       * sort a page of at most 200 by position for display.
       */
      .orderBy(asc(sessionLocation.id))
      .limit(input.limit + 1)

    const [clock] = await tx.execute<{ now: string }>(sql`select transaction_timestamp() as now`)

    const hasMore = rows.length > input.limit
    const page = hasMore ? rows.slice(0, input.limit) : rows

    return {
      items: page,
      nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
      syncedAt: new Date(clock!.now),
    }
  })
}

export async function updateSessionLocation(
  db: Database,
  ctx: TenantContext,
  input: UpdateSessionLocationInput,
) {
  const { id, ...patch } = input

  return withTenant(db, ctx, async (tx) => {
    const [row] = await tx
      .update(sessionLocation)
      .set(patch)
      .where(and(eq(sessionLocation.id, id), visibility(ctx.workspaceId, false)))
      .returning()

    if (!row) throw new NotFoundError('Session location', id)
    return row
  })
}

export async function removeSessionLocation(db: Database, ctx: TenantContext, id: string) {
  return withTenant(db, ctx, async (tx) => {
    const [row] = await tx
      .update(sessionLocation)
      .set({ deletedAt: new Date() })
      .where(and(eq(sessionLocation.id, id), visibility(ctx.workspaceId, false)))
      .returning()

    if (!row) throw new NotFoundError('Session location', id)
    return row
  })
}

/**
 * Rewrite a session's visiting order in one transaction.
 *
 * Requires every live stop on the session. A partial list would leave the
 * omitted stops interleaved at stale positions, which looks like the drag
 * did not take and is far harder to diagnose than a rejected request.
 */
export async function reorderSessionLocations(
  db: Database,
  ctx: TenantContext,
  input: ReorderSessionLocationsInput,
): Promise<{ reordered: number }> {
  return withTenant(db, ctx, async (tx) => {
    await assertSessionUsable(tx, ctx.workspaceId, input.sessionId)

    const unique = new Set(input.orderedIds)
    if (unique.size !== input.orderedIds.length) {
      throw new ValidationError('The same stop was listed more than once', 'orderedIds')
    }

    const live = await tx
      .select({ id: sessionLocation.id })
      .from(sessionLocation)
      .where(
        and(eq(sessionLocation.sessionId, input.sessionId), visibility(ctx.workspaceId, false)),
      )

    const liveIds = new Set(live.map((row) => row.id))

    const unknown = input.orderedIds.find((id) => !liveIds.has(id))
    if (unknown) throw new NotFoundError('Session location', unknown)

    if (liveIds.size !== unique.size) {
      throw new ValidationError(
        `Reordering must list every stop on the session (expected ${liveIds.size}, got ${unique.size})`,
        'orderedIds',
      )
    }

    const values = sql.join(
      input.orderedIds.map((id, index) => sql`(${id}::uuid, ${index * POSITION_STEP}::integer)`),
      sql`, `,
    )

    await tx.execute(sql`
      update ${sessionLocation} as sl
         set position = v.position
        from (values ${values}) as v(id, position)
       where sl.id = v.id
         and sl.workspace_id = ${ctx.workspaceId}::uuid
    `)

    return { reordered: input.orderedIds.length }
  })
}
