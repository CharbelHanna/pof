import { and, asc, eq, gt, gte, isNull, sql, type SQL } from 'drizzle-orm'
import { schema, withTenant, type Database, type TenantContext, type TenantDb } from '@pof/db'
import type {
  AddShootGearInput,
  CreateGearItemInput,
  ListGearItemsInput,
  ListShootGearInput,
  UpdateGearItemInput,
  UpdateShootGearInput,
} from '@pof/schemas'

import { NotFoundError, ValidationError } from '../../errors.ts'
import * as shootRepo from '../planning/shoot.repository.ts'

/**
 * Gear: the workspace's library of owned kit, and what is selected for a
 * given shoot.
 */

const { gearItem, shootGear } = schema

const itemVisibility = (workspaceId: string, includeDeleted: boolean) =>
  includeDeleted
    ? eq(gearItem.workspaceId, workspaceId)
    : and(eq(gearItem.workspaceId, workspaceId), isNull(gearItem.deletedAt))

const shootGearVisibility = (workspaceId: string, includeDeleted: boolean) =>
  includeDeleted
    ? eq(shootGear.workspaceId, workspaceId)
    : and(eq(shootGear.workspaceId, workspaceId), isNull(shootGear.deletedAt))

// --- library -------------------------------------------------------------

export async function createGearItem(db: Database, ctx: TenantContext, input: CreateGearItemInput) {
  return withTenant(db, ctx, async (tx) => {
    const [row] = await tx
      .insert(gearItem)
      .values({
        ...(input.id ? { id: input.id } : {}),
        workspaceId: ctx.workspaceId,
        name: input.name,
        category: input.category ?? null,
        notes: input.notes ?? null,
      })
      .onConflictDoNothing({ target: gearItem.id })
      .returning()

    if (row) return row

    const [existing] = await tx
      .select()
      .from(gearItem)
      .where(and(eq(gearItem.id, input.id!), itemVisibility(ctx.workspaceId, true)))
      .limit(1)
    if (!existing) throw new NotFoundError('Gear item', input.id)
    return existing
  })
}

export async function listGearItems(db: Database, ctx: TenantContext, input: ListGearItemsInput) {
  return withTenant(db, ctx, async (tx) => {
    const predicates: (SQL | undefined)[] = [itemVisibility(ctx.workspaceId, input.includeDeleted)]
    if (input.updatedSince) predicates.push(gte(gearItem.updatedAt, input.updatedSince))
    if (input.cursor) predicates.push(gt(gearItem.id, input.cursor))

    const rows = await tx
      .select()
      .from(gearItem)
      .where(and(...predicates))
      .orderBy(asc(gearItem.id))
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

export async function updateGearItem(db: Database, ctx: TenantContext, input: UpdateGearItemInput) {
  const { id, ...patch } = input

  return withTenant(db, ctx, async (tx) => {
    const [row] = await tx
      .update(gearItem)
      .set(patch)
      .where(and(eq(gearItem.id, id), itemVisibility(ctx.workspaceId, false)))
      .returning()

    if (!row) throw new NotFoundError('Gear item', id)
    return row
  })
}

/**
 * Retires a library item.
 *
 * Soft delete, deliberately: shoots already planned around this item keep
 * their rows and still show it. A hard delete would be refused anyway — the
 * foreign key from `shoot_gear` is ON DELETE RESTRICT, so the database will
 * not let a packing list be rewritten silently.
 */
export async function deleteGearItem(db: Database, ctx: TenantContext, id: string) {
  return withTenant(db, ctx, async (tx) => {
    const [row] = await tx
      .update(gearItem)
      .set({ deletedAt: new Date() })
      .where(and(eq(gearItem.id, id), itemVisibility(ctx.workspaceId, false)))
      .returning()

    if (!row) throw new NotFoundError('Gear item', id)
    return row
  })
}

// --- selection for a shoot ------------------------------------------------

async function assertShootUsable(tx: TenantDb, workspaceId: string, shootId: string) {
  const parent = await shootRepo.findShootById(tx, workspaceId, shootId)
  if (!parent) throw new NotFoundError('Shoot', shootId)
  if (parent.deletedAt) {
    throw new ValidationError('Cannot add gear to a deleted shoot', 'shootId')
  }
}

export async function addShootGear(db: Database, ctx: TenantContext, input: AddShootGearInput) {
  return withTenant(db, ctx, async (tx) => {
    await assertShootUsable(tx, ctx.workspaceId, input.shootId)

    const [item] = await tx
      .select()
      .from(gearItem)
      .where(and(eq(gearItem.id, input.gearItemId), itemVisibility(ctx.workspaceId, false)))
      .limit(1)
    if (!item) throw new NotFoundError('Gear item', input.gearItemId)

    const [row] = await tx
      .insert(shootGear)
      .values({
        ...(input.id ? { id: input.id } : {}),
        workspaceId: ctx.workspaceId,
        shootId: input.shootId,
        gearItemId: input.gearItemId,
        quantity: input.quantity,
      })
      /**
       * Adding the same item twice is not an error, it is someone clicking
       * again. Conflict is on (workspace, shoot, item), so the existing row
       * is returned rather than a duplicate created or a 500 raised.
       */
      .onConflictDoNothing({
        target: [shootGear.workspaceId, shootGear.shootId, shootGear.gearItemId],
      })
      .returning()

    if (row) return row

    const [existing] = await tx
      .select()
      .from(shootGear)
      .where(
        and(
          eq(shootGear.shootId, input.shootId),
          eq(shootGear.gearItemId, input.gearItemId),
          shootGearVisibility(ctx.workspaceId, true),
        ),
      )
      .limit(1)
    if (!existing) throw new NotFoundError('Gear on shoot', input.gearItemId)

    // A previously removed item being re-added should come back, not stay
    // invisible behind its tombstone.
    if (existing.deletedAt) {
      const [restored] = await tx
        .update(shootGear)
        .set({ deletedAt: null, quantity: input.quantity })
        .where(eq(shootGear.id, existing.id))
        .returning()
      return restored!
    }

    return existing
  })
}

export async function listShootGear(db: Database, ctx: TenantContext, input: ListShootGearInput) {
  return withTenant(db, ctx, async (tx) => {
    const predicates: (SQL | undefined)[] = [
      shootGearVisibility(ctx.workspaceId, input.includeDeleted),
    ]
    if (input.shootId) predicates.push(eq(shootGear.shootId, input.shootId))
    if (input.updatedSince) predicates.push(gte(shootGear.updatedAt, input.updatedSince))
    if (input.cursor) predicates.push(gt(shootGear.id, input.cursor))

    // Joined so the caller gets the item's name without a second round trip
    // and without the UI having to stitch two lists together.
    const rows = await tx
      .select({
        id: shootGear.id,
        workspaceId: shootGear.workspaceId,
        shootId: shootGear.shootId,
        gearItemId: shootGear.gearItemId,
        quantity: shootGear.quantity,
        packed: shootGear.packed,
        createdAt: shootGear.createdAt,
        updatedAt: shootGear.updatedAt,
        deletedAt: shootGear.deletedAt,
        name: gearItem.name,
        category: gearItem.category,
      })
      .from(shootGear)
      .innerJoin(gearItem, eq(gearItem.id, shootGear.gearItemId))
      .where(and(...predicates))
      .orderBy(asc(shootGear.id))
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

export async function updateShootGear(
  db: Database,
  ctx: TenantContext,
  input: UpdateShootGearInput,
) {
  const { id, ...patch } = input

  return withTenant(db, ctx, async (tx) => {
    const [row] = await tx
      .update(shootGear)
      .set(patch)
      .where(and(eq(shootGear.id, id), shootGearVisibility(ctx.workspaceId, false)))
      .returning()

    if (!row) throw new NotFoundError('Gear on shoot', id)
    return row
  })
}

export async function removeShootGear(db: Database, ctx: TenantContext, id: string) {
  return withTenant(db, ctx, async (tx) => {
    const [row] = await tx
      .update(shootGear)
      .set({ deletedAt: new Date() })
      .where(and(eq(shootGear.id, id), shootGearVisibility(ctx.workspaceId, false)))
      .returning()

    if (!row) throw new NotFoundError('Gear on shoot', id)
    return row
  })
}
