import { and, asc, eq, gt, gte, isNull, max, sql, type SQL } from 'drizzle-orm'
import { schema, withTenant, type Database, type TenantContext, type TenantDb } from '@pof/db'
import type {
  AddMoodboardItemInput,
  CreateMoodboardInput,
  ListMoodboardItemsInput,
  ListMoodboardsInput,
  ReorderMoodboardInput,
  UpdateMoodboardInput,
  UpdateMoodboardItemInput,
} from '@pof/schemas'

import { NotFoundError, ValidationError } from '../../errors.ts'
import * as shootRepo from '../planning/shoot.repository.ts'

/**
 * Moodboards and what is on them.
 *
 * Curation, kept separate from storage: an item is a decision about an asset
 * — this one, here, with this caption — so the same uploaded reference can
 * appear on two boards and on a shot without the file existing twice.
 */

const { asset, moodboard, moodboardItem } = schema

/** Leaves room to drop an image between two others without renumbering. */
const POSITION_STEP = 10

function boardVisibility(workspaceId: string, includeDeleted: boolean): SQL | undefined {
  const scope = eq(moodboard.workspaceId, workspaceId)
  return includeDeleted ? scope : and(scope, isNull(moodboard.deletedAt))
}

function itemVisibility(workspaceId: string, includeDeleted: boolean): SQL | undefined {
  const scope = eq(moodboardItem.workspaceId, workspaceId)
  return includeDeleted ? scope : and(scope, isNull(moodboardItem.deletedAt))
}

async function assertShootUsable(tx: TenantDb, workspaceId: string, shootId: string) {
  const parent = await shootRepo.findShootById(tx, workspaceId, shootId)
  if (!parent) throw new NotFoundError('Shoot', shootId)
  if (parent.deletedAt) {
    throw new ValidationError('Cannot add a moodboard to a deleted shoot', 'shootId')
  }
}

export async function createMoodboard(
  db: Database,
  ctx: TenantContext,
  input: CreateMoodboardInput,
) {
  return withTenant(db, ctx, async (tx) => {
    await assertShootUsable(tx, ctx.workspaceId, input.shootId)

    const [row] = await tx
      .insert(moodboard)
      .values({
        ...(input.id ? { id: input.id } : {}),
        workspaceId: ctx.workspaceId,
        shootId: input.shootId,
        name: input.name,
        notes: input.notes ?? null,
      })
      .onConflictDoNothing({ target: moodboard.id })
      .returning()

    if (row) return row

    const [existing] = await tx
      .select()
      .from(moodboard)
      .where(and(eq(moodboard.id, input.id!), boardVisibility(ctx.workspaceId, true)))
      .limit(1)

    if (!existing) throw new NotFoundError('Moodboard', input.id)
    return existing
  })
}

export async function listMoodboards(db: Database, ctx: TenantContext, input: ListMoodboardsInput) {
  return withTenant(db, ctx, async (tx) => {
    const predicates: (SQL | undefined)[] = [boardVisibility(ctx.workspaceId, input.includeDeleted)]

    if (input.shootId) predicates.push(eq(moodboard.shootId, input.shootId))
    if (input.updatedSince) predicates.push(gte(moodboard.updatedAt, input.updatedSince))
    if (input.cursor) predicates.push(gt(moodboard.id, input.cursor))

    const rows = await tx
      .select()
      .from(moodboard)
      .where(and(...predicates))
      .orderBy(asc(moodboard.id))
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

export async function updateMoodboard(
  db: Database,
  ctx: TenantContext,
  input: UpdateMoodboardInput,
) {
  const { id, ...patch } = input

  return withTenant(db, ctx, async (tx) => {
    const [row] = await tx
      .update(moodboard)
      .set(patch)
      .where(and(eq(moodboard.id, id), boardVisibility(ctx.workspaceId, false)))
      .returning()

    if (!row) throw new NotFoundError('Moodboard', id)
    return row
  })
}

export async function deleteMoodboard(db: Database, ctx: TenantContext, id: string) {
  return withTenant(db, ctx, async (tx) => {
    const [row] = await tx
      .update(moodboard)
      .set({ deletedAt: new Date() })
      .where(and(eq(moodboard.id, id), boardVisibility(ctx.workspaceId, false)))
      .returning()

    if (!row) throw new NotFoundError('Moodboard', id)
    return row
  })
}

// --- items ----------------------------------------------------------------

async function nextPosition(tx: TenantDb, workspaceId: string, boardId: string): Promise<number> {
  const [row] = await tx
    .select({ highest: max(moodboardItem.position) })
    .from(moodboardItem)
    .where(and(eq(moodboardItem.moodboardId, boardId), itemVisibility(workspaceId, true)))

  return (row?.highest ?? -POSITION_STEP) + POSITION_STEP
}

export async function addMoodboardItem(
  db: Database,
  ctx: TenantContext,
  input: AddMoodboardItemInput,
) {
  return withTenant(db, ctx, async (tx) => {
    const [board] = await tx
      .select({ id: moodboard.id })
      .from(moodboard)
      .where(and(eq(moodboard.id, input.moodboardId), boardVisibility(ctx.workspaceId, false)))
      .limit(1)
    if (!board) throw new NotFoundError('Moodboard', input.moodboardId)

    /**
     * The asset must exist and belong here. The composite foreign key would
     * catch a cross-workspace reference anyway, but as an opaque 500 — and
     * this also rejects an asset that was soft-deleted, which the key would
     * happily allow.
     */
    const [file] = await tx
      .select({ id: asset.id })
      .from(asset)
      .where(
        and(
          eq(asset.id, input.assetId),
          eq(asset.workspaceId, ctx.workspaceId),
          isNull(asset.deletedAt),
        ),
      )
      .limit(1)
    if (!file) throw new NotFoundError('Asset', input.assetId)

    const [row] = await tx
      .insert(moodboardItem)
      .values({
        ...(input.id ? { id: input.id } : {}),
        workspaceId: ctx.workspaceId,
        moodboardId: input.moodboardId,
        assetId: input.assetId,
        position: input.position ?? (await nextPosition(tx, ctx.workspaceId, input.moodboardId)),
        caption: input.caption ?? null,
      })
      /**
       * Dropping the same image on a board twice is someone releasing the
       * mouse over a tile that is already there, not an error.
       */
      .onConflictDoNothing({
        target: [moodboardItem.workspaceId, moodboardItem.moodboardId, moodboardItem.assetId],
      })
      .returning()

    if (row) return row

    const [existing] = await tx
      .select()
      .from(moodboardItem)
      .where(
        and(
          eq(moodboardItem.moodboardId, input.moodboardId),
          eq(moodboardItem.assetId, input.assetId),
          itemVisibility(ctx.workspaceId, true),
        ),
      )
      .limit(1)

    if (!existing) throw new NotFoundError('Moodboard item', input.assetId)
    return existing
  })
}

export async function listMoodboardItems(
  db: Database,
  ctx: TenantContext,
  input: ListMoodboardItemsInput,
) {
  return withTenant(db, ctx, async (tx) => {
    const predicates: (SQL | undefined)[] = [itemVisibility(ctx.workspaceId, input.includeDeleted)]

    if (input.moodboardId) predicates.push(eq(moodboardItem.moodboardId, input.moodboardId))
    if (input.updatedSince) predicates.push(gte(moodboardItem.updatedAt, input.updatedSince))
    if (input.cursor) predicates.push(gt(moodboardItem.id, input.cursor))

    const rows = await tx
      .select()
      .from(moodboardItem)
      .where(and(...predicates))
      /**
       * Keyset pagination needs a unique, stable sort, and `position` is
       * neither. Callers sort a page by position for display.
       */
      .orderBy(asc(moodboardItem.id))
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

export async function updateMoodboardItem(
  db: Database,
  ctx: TenantContext,
  input: UpdateMoodboardItemInput,
) {
  const { id, ...patch } = input

  return withTenant(db, ctx, async (tx) => {
    const [row] = await tx
      .update(moodboardItem)
      .set(patch)
      .where(and(eq(moodboardItem.id, id), itemVisibility(ctx.workspaceId, false)))
      .returning()

    if (!row) throw new NotFoundError('Moodboard item', id)
    return row
  })
}

export async function removeMoodboardItem(db: Database, ctx: TenantContext, id: string) {
  return withTenant(db, ctx, async (tx) => {
    const [row] = await tx
      .update(moodboardItem)
      .set({ deletedAt: new Date() })
      .where(and(eq(moodboardItem.id, id), itemVisibility(ctx.workspaceId, false)))
      .returning()

    if (!row) throw new NotFoundError('Moodboard item', id)
    return row
  })
}

/**
 * Rewrite a board's arrangement in one transaction.
 *
 * Requires every live item. A partial list would leave the omitted images at
 * stale positions, which on a surface whose whole purpose is the arrangement
 * reads as the drag silently failing.
 */
export async function reorderMoodboard(
  db: Database,
  ctx: TenantContext,
  input: ReorderMoodboardInput,
): Promise<{ reordered: number }> {
  return withTenant(db, ctx, async (tx) => {
    const [board] = await tx
      .select({ id: moodboard.id })
      .from(moodboard)
      .where(and(eq(moodboard.id, input.moodboardId), boardVisibility(ctx.workspaceId, false)))
      .limit(1)
    if (!board) throw new NotFoundError('Moodboard', input.moodboardId)

    const unique = new Set(input.orderedIds)
    if (unique.size !== input.orderedIds.length) {
      throw new ValidationError('The same item was listed more than once', 'orderedIds')
    }

    const live = await tx
      .select({ id: moodboardItem.id })
      .from(moodboardItem)
      .where(
        and(
          eq(moodboardItem.moodboardId, input.moodboardId),
          itemVisibility(ctx.workspaceId, false),
        ),
      )

    const liveIds = new Set(live.map((row) => row.id))

    const unknown = input.orderedIds.find((id) => !liveIds.has(id))
    if (unknown) throw new NotFoundError('Moodboard item', unknown)

    if (liveIds.size !== unique.size) {
      throw new ValidationError(
        `Reordering must list every item on the board (expected ${liveIds.size}, got ${unique.size})`,
        'orderedIds',
      )
    }

    const values = sql.join(
      input.orderedIds.map((id, index) => sql`(${id}::uuid, ${index * POSITION_STEP}::integer)`),
      sql`, `,
    )

    await tx.execute(sql`
      update ${moodboardItem} as mi
         set position = v.position
        from (values ${values}) as v(id, position)
       where mi.id = v.id
         and mi.workspace_id = ${ctx.workspaceId}::uuid
    `)

    return { reordered: input.orderedIds.length }
  })
}
