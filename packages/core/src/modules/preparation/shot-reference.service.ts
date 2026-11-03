import { and, asc, eq, gt, gte, isNull, max, sql, type SQL } from 'drizzle-orm'
import { schema, withTenant, type Database, type TenantContext, type TenantDb } from '@pof/db'
import type {
  AddShotReferenceInput,
  ListShotReferencesInput,
  UpdateShotReferenceInput,
} from '@pof/schemas'

import { NotFoundError } from '../../errors.ts'

/**
 * Reference images attached to one shot.
 *
 * Separate from the moodboard service even though both point at `asset`,
 * because they answer different questions: a moodboard is the feel of the
 * shoot, a shot reference is an instruction for one frame. The same file is
 * routinely both, which is why neither owns it.
 */

const { asset, shot, shotReference } = schema

/** Leaves room to insert between two references without renumbering. */
const POSITION_STEP = 10

function visibility(workspaceId: string, includeDeleted: boolean): SQL | undefined {
  const scope = eq(shotReference.workspaceId, workspaceId)
  return includeDeleted ? scope : and(scope, isNull(shotReference.deletedAt))
}

async function nextPosition(tx: TenantDb, workspaceId: string, shotId: string): Promise<number> {
  const [row] = await tx
    .select({ highest: max(shotReference.position) })
    .from(shotReference)
    .where(and(eq(shotReference.shotId, shotId), visibility(workspaceId, true)))

  return (row?.highest ?? -POSITION_STEP) + POSITION_STEP
}

export async function addShotReference(
  db: Database,
  ctx: TenantContext,
  input: AddShotReferenceInput,
) {
  return withTenant(db, ctx, async (tx) => {
    /**
     * Both parents are checked explicitly. The composite foreign keys would
     * reject a cross-workspace reference anyway, but as an opaque 500 — and
     * these checks also reject a soft-deleted shot or asset, which the keys
     * would happily accept.
     */
    const [frame] = await tx
      .select({ id: shot.id })
      .from(shot)
      .where(
        and(
          eq(shot.id, input.shotId),
          eq(shot.workspaceId, ctx.workspaceId),
          isNull(shot.deletedAt),
        ),
      )
      .limit(1)
    if (!frame) throw new NotFoundError('Shot', input.shotId)

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
      .insert(shotReference)
      .values({
        ...(input.id ? { id: input.id } : {}),
        workspaceId: ctx.workspaceId,
        shotId: input.shotId,
        assetId: input.assetId,
        position: input.position ?? (await nextPosition(tx, ctx.workspaceId, input.shotId)),
        note: input.note ?? null,
      })
      /** Attaching the same image twice is a second click, not an error. */
      .onConflictDoNothing({
        target: [shotReference.workspaceId, shotReference.shotId, shotReference.assetId],
      })
      .returning()

    if (row) return row

    const [existing] = await tx
      .select()
      .from(shotReference)
      .where(
        and(
          eq(shotReference.shotId, input.shotId),
          eq(shotReference.assetId, input.assetId),
          visibility(ctx.workspaceId, true),
        ),
      )
      .limit(1)

    if (!existing) throw new NotFoundError('Shot reference', input.assetId)
    return existing
  })
}

export async function listShotReferences(
  db: Database,
  ctx: TenantContext,
  input: ListShotReferencesInput,
) {
  return withTenant(db, ctx, async (tx) => {
    const predicates: (SQL | undefined)[] = [visibility(ctx.workspaceId, input.includeDeleted)]

    if (input.shotId) predicates.push(eq(shotReference.shotId, input.shotId))
    if (input.updatedSince) predicates.push(gte(shotReference.updatedAt, input.updatedSince))
    if (input.cursor) predicates.push(gt(shotReference.id, input.cursor))

    const rows = await tx
      .select()
      .from(shotReference)
      .where(and(...predicates))
      /**
       * Keyset pagination needs a unique, stable sort, and `position` is
       * neither. Callers sort a page by position for display.
       */
      .orderBy(asc(shotReference.id))
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

export async function updateShotReference(
  db: Database,
  ctx: TenantContext,
  input: UpdateShotReferenceInput,
) {
  const { id, ...patch } = input

  return withTenant(db, ctx, async (tx) => {
    const [row] = await tx
      .update(shotReference)
      .set(patch)
      .where(and(eq(shotReference.id, id), visibility(ctx.workspaceId, false)))
      .returning()

    if (!row) throw new NotFoundError('Shot reference', id)
    return row
  })
}

export async function removeShotReference(db: Database, ctx: TenantContext, id: string) {
  return withTenant(db, ctx, async (tx) => {
    const [row] = await tx
      .update(shotReference)
      .set({ deletedAt: new Date() })
      .where(and(eq(shotReference.id, id), visibility(ctx.workspaceId, false)))
      .returning()

    if (!row) throw new NotFoundError('Shot reference', id)
    return row
  })
}
