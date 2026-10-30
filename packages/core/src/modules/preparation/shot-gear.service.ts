import { and, asc, eq, gt, gte, isNull, sql, type SQL } from 'drizzle-orm'
import { schema, withTenant, type Database, type TenantContext, type TenantDb } from '@pof/db'
import type {
  AddShotGearRequirementInput,
  ListShotGearRequirementsInput,
  UpdateShotGearRequirementInput,
} from '@pof/schemas'

import { NotFoundError } from '../../errors.ts'

/**
 * Gear a specific shot calls for.
 *
 * Separate from `gear.service.ts`, which owns the library and the shoot's
 * packing list. The distinction is the point: packing is a shoot-level
 * activity done once for the day, while a requirement is planning attached to
 * a single frame. See the schema comment on `shot_gear_requirement` for why
 * the table is not called `shot_gear`.
 */

const { gearItem, shot, shotGearRequirement } = schema

function visibility(workspaceId: string, includeDeleted: boolean): SQL | undefined {
  const scope = eq(shotGearRequirement.workspaceId, workspaceId)
  return includeDeleted ? scope : and(scope, isNull(shotGearRequirement.deletedAt))
}

/**
 * The composite foreign keys already make a cross-workspace reference
 * impossible, but a constraint violation reaches the user as an opaque 500.
 * Checking first turns it into a clean "not found".
 */
async function assertShotUsable(tx: TenantDb, workspaceId: string, shotId: string) {
  const [parent] = await tx
    .select({ deletedAt: shot.deletedAt })
    .from(shot)
    .where(and(eq(shot.id, shotId), eq(shot.workspaceId, workspaceId), isNull(shot.deletedAt)))
    .limit(1)

  if (!parent) throw new NotFoundError('Shot', shotId)
}

export async function addShotGearRequirement(
  db: Database,
  ctx: TenantContext,
  input: AddShotGearRequirementInput,
) {
  return withTenant(db, ctx, async (tx) => {
    await assertShotUsable(tx, ctx.workspaceId, input.shotId)

    const [item] = await tx
      .select({ id: gearItem.id })
      .from(gearItem)
      .where(
        and(
          eq(gearItem.id, input.gearItemId),
          eq(gearItem.workspaceId, ctx.workspaceId),
          isNull(gearItem.deletedAt),
        ),
      )
      .limit(1)
    if (!item) throw new NotFoundError('Gear item', input.gearItemId)

    const [row] = await tx
      .insert(shotGearRequirement)
      .values({
        ...(input.id ? { id: input.id } : {}),
        workspaceId: ctx.workspaceId,
        shotId: input.shotId,
        gearItemId: input.gearItemId,
        quantity: input.quantity,
        notes: input.notes ?? null,
      })
      /**
       * Requiring the same item twice is not an error, it is someone clicking
       * again. Conflict is on (workspace, shot, item), so the existing row is
       * returned rather than a duplicate created or a 500 raised.
       */
      .onConflictDoNothing({
        target: [
          shotGearRequirement.workspaceId,
          shotGearRequirement.shotId,
          shotGearRequirement.gearItemId,
        ],
      })
      .returning()

    if (row) return row

    const [existing] = await tx
      .select()
      .from(shotGearRequirement)
      .where(
        and(
          eq(shotGearRequirement.shotId, input.shotId),
          eq(shotGearRequirement.gearItemId, input.gearItemId),
          visibility(ctx.workspaceId, true),
        ),
      )
      .limit(1)

    if (!existing) throw new NotFoundError('Gear requirement', input.gearItemId)
    return existing
  })
}

export async function listShotGearRequirements(
  db: Database,
  ctx: TenantContext,
  input: ListShotGearRequirementsInput,
) {
  return withTenant(db, ctx, async (tx) => {
    const predicates: (SQL | undefined)[] = [visibility(ctx.workspaceId, input.includeDeleted)]

    if (input.shotId) predicates.push(eq(shotGearRequirement.shotId, input.shotId))
    if (input.updatedSince) predicates.push(gte(shotGearRequirement.updatedAt, input.updatedSince))
    if (input.cursor) predicates.push(gt(shotGearRequirement.id, input.cursor))

    const rows = await tx
      .select()
      .from(shotGearRequirement)
      .where(and(...predicates))
      .orderBy(asc(shotGearRequirement.id))
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

export async function updateShotGearRequirement(
  db: Database,
  ctx: TenantContext,
  input: UpdateShotGearRequirementInput,
) {
  const { id, ...patch } = input

  return withTenant(db, ctx, async (tx) => {
    const [row] = await tx
      .update(shotGearRequirement)
      .set(patch)
      .where(and(eq(shotGearRequirement.id, id), visibility(ctx.workspaceId, false)))
      .returning()

    if (!row) throw new NotFoundError('Gear requirement', id)
    return row
  })
}

export async function removeShotGearRequirement(db: Database, ctx: TenantContext, id: string) {
  return withTenant(db, ctx, async (tx) => {
    const [row] = await tx
      .update(shotGearRequirement)
      .set({ deletedAt: new Date() })
      .where(and(eq(shotGearRequirement.id, id), visibility(ctx.workspaceId, false)))
      .returning()

    if (!row) throw new NotFoundError('Gear requirement', id)
    return row
  })
}
