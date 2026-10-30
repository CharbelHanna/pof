import { and, asc, eq, gt, gte, inArray, isNull, max, sql, type SQL } from 'drizzle-orm'
import { schema, withTenant, type Database, type TenantContext, type TenantDb } from '@pof/db'
import type {
  CreateShotInput,
  ListShotsInput,
  ReorderShotsInput,
  UpdateShotInput,
} from '@pof/schemas'

import { NotFoundError, ValidationError } from '../../errors.ts'
import * as shootRepo from '../planning/shoot.repository.ts'

/**
 * Shots on a shoot.
 *
 * Repository and service are one file, as with crew and gear: a shot has no
 * behaviour beyond scoped CRUD, a parent check and the running order.
 */

const { shot } = schema

/** Leaves room to insert between two shots without renumbering. */
const POSITION_STEP = 10

function visibility(workspaceId: string, includeDeleted: boolean): SQL | undefined {
  const scope = eq(shot.workspaceId, workspaceId)
  return includeDeleted ? scope : and(scope, isNull(shot.deletedAt))
}

/**
 * The composite foreign keys already make a cross-workspace or cross-shoot
 * reference impossible, but a constraint violation reaches the user as an
 * opaque 500. Checking first turns it into a clean "not found".
 */
async function assertShootUsable(tx: TenantDb, workspaceId: string, shootId: string) {
  const parent = await shootRepo.findShootById(tx, workspaceId, shootId)
  if (!parent) throw new NotFoundError('Shoot', shootId)
  if (parent.deletedAt) {
    throw new ValidationError('Cannot add a shot to a deleted shoot', 'shootId')
  }
}

/** Appends to the end of the shoot's running order. */
async function nextPosition(tx: TenantDb, workspaceId: string, shootId: string): Promise<number> {
  const [row] = await tx
    .select({ highest: max(shot.position) })
    .from(shot)
    .where(and(eq(shot.shootId, shootId), visibility(workspaceId, true)))

  return (row?.highest ?? -POSITION_STEP) + POSITION_STEP
}

export async function createShot(db: Database, ctx: TenantContext, input: CreateShotInput) {
  return withTenant(db, ctx, async (tx) => {
    await assertShootUsable(tx, ctx.workspaceId, input.shootId)

    const [row] = await tx
      .insert(shot)
      .values({
        ...(input.id ? { id: input.id } : {}),
        workspaceId: ctx.workspaceId,
        shootId: input.shootId,
        sessionId: input.sessionId ?? null,
        title: input.title,
        description: input.description ?? null,
        framing: input.framing ?? null,
        subjects: input.subjects ?? null,
        props: input.props ?? null,
        status: input.status,
        position: input.position ?? (await nextPosition(tx, ctx.workspaceId, input.shootId)),
        notes: input.notes ?? null,
      })
      .onConflictDoNothing({ target: shot.id })
      .returning()

    if (row) return row

    // Replayed offline mutation or double submit: return the original.
    const existing = input.id ? await findShot(tx, ctx.workspaceId, input.id) : undefined
    if (!existing) throw new NotFoundError('Shot', input.id)
    return existing
  })
}

async function findShot(tx: TenantDb, workspaceId: string, id: string) {
  const [row] = await tx
    .select()
    .from(shot)
    .where(and(eq(shot.id, id), visibility(workspaceId, true)))
    .limit(1)

  return row
}

export async function listShots(db: Database, ctx: TenantContext, input: ListShotsInput) {
  return withTenant(db, ctx, async (tx) => {
    const predicates: (SQL | undefined)[] = [visibility(ctx.workspaceId, input.includeDeleted)]

    if (input.shootId) predicates.push(eq(shot.shootId, input.shootId))
    /**
     * `null` is a meaningful filter, not an absent one: it asks for shots
     * belonging to the whole shoot rather than to a session. `undefined`
     * means no session filter at all.
     */
    if (input.sessionId === null) predicates.push(isNull(shot.sessionId))
    else if (input.sessionId) predicates.push(eq(shot.sessionId, input.sessionId))
    if (input.status) predicates.push(eq(shot.status, input.status))
    if (input.updatedSince) predicates.push(gte(shot.updatedAt, input.updatedSince))
    if (input.cursor) predicates.push(gt(shot.id, input.cursor))

    const rows = await tx
      .select()
      .from(shot)
      .where(and(...predicates))
      /**
       * Keyset pagination needs a unique, stable sort, and `position` is
       * neither — it repeats across shoots and changes on reorder. Ordering
       * by id keeps the cursor correct; callers render in `position` order,
       * which is cheap for a page of at most 200.
       */
      .orderBy(asc(shot.id))
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

export async function updateShot(db: Database, ctx: TenantContext, input: UpdateShotInput) {
  const { id, ...patch } = input

  return withTenant(db, ctx, async (tx) => {
    const [row] = await tx
      .update(shot)
      .set(patch)
      .where(and(eq(shot.id, id), visibility(ctx.workspaceId, false)))
      .returning()

    if (!row) throw new NotFoundError('Shot', id)
    return row
  })
}

export async function deleteShot(db: Database, ctx: TenantContext, id: string) {
  return withTenant(db, ctx, async (tx) => {
    const [row] = await tx
      .update(shot)
      .set({ deletedAt: new Date() })
      .where(and(eq(shot.id, id), visibility(ctx.workspaceId, false)))
      .returning()

    if (!row) throw new NotFoundError('Shot', id)
    return row
  })
}

/**
 * Rewrite the running order of a shoot's shots in one transaction.
 *
 * Every id must belong to this shoot, and the caller must list all of its
 * live shots. Accepting a partial list would silently leave the omitted
 * shots interleaved at stale positions, which looks like the drag "didn't
 * take" — and is far harder to diagnose than a rejected request.
 */
export async function reorderShots(
  db: Database,
  ctx: TenantContext,
  input: ReorderShotsInput,
): Promise<{ reordered: number }> {
  return withTenant(db, ctx, async (tx) => {
    await assertShootUsable(tx, ctx.workspaceId, input.shootId)

    const unique = new Set(input.orderedIds)
    if (unique.size !== input.orderedIds.length) {
      throw new ValidationError('The same shot was listed more than once', 'orderedIds')
    }

    const live = await tx
      .select({ id: shot.id })
      .from(shot)
      .where(and(eq(shot.shootId, input.shootId), visibility(ctx.workspaceId, false)))

    const liveIds = new Set(live.map((row) => row.id))

    const unknown = input.orderedIds.find((id) => !liveIds.has(id))
    if (unknown) throw new NotFoundError('Shot', unknown)

    if (liveIds.size !== unique.size) {
      throw new ValidationError(
        `Reordering must list every shot on the shoot (expected ${liveIds.size}, got ${unique.size})`,
        'orderedIds',
      )
    }

    /**
     * One UPDATE ... FROM (VALUES ...) rather than a statement per shot.
     * A fifty-shot list would otherwise be fifty round trips inside the
     * transaction, holding row locks the whole way.
     */
    const values = sql.join(
      input.orderedIds.map((id, index) => sql`(${id}::uuid, ${index * POSITION_STEP}::integer)`),
      sql`, `,
    )

    await tx.execute(sql`
      update ${shot} as s
         set position = v.position
        from (values ${values}) as v(id, position)
       where s.id = v.id
         and s.workspace_id = ${ctx.workspaceId}::uuid
    `)

    return { reordered: input.orderedIds.length }
  })
}

/** Exported for the reorder path's callers; keeps `inArray` honest. */
export async function findShotsByIds(db: Database, ctx: TenantContext, ids: string[]) {
  if (ids.length === 0) return []

  return withTenant(db, ctx, async (tx) =>
    tx
      .select()
      .from(shot)
      .where(and(inArray(shot.id, ids), visibility(ctx.workspaceId, true))),
  )
}
