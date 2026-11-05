import { and, asc, eq, gt, gte, isNull, max, sql, type SQL } from 'drizzle-orm'
import { schema, withTenant, type Database, type TenantContext, type TenantDb } from '@pof/db'
import type {
  AddChecklistItemsInput,
  CreateChecklistInput,
  CreateChecklistItemInput,
  ListChecklistItemsInput,
  ListChecklistsInput,
  ReorderChecklistItemsInput,
  SetChecklistItemDoneInput,
  UpdateChecklistInput,
  UpdateChecklistItemInput,
} from '@pof/schemas'

import { NotFoundError, ValidationError } from '../../errors.ts'
import * as shootRepo from '../planning/shoot.repository.ts'

/**
 * Checklists and their items.
 *
 * Repository and service are one file, as with shots, crew and gear: there is
 * no behaviour here beyond scoped CRUD, a parent check, the running order and
 * the one thing that is genuinely a rule — that the server, not the client,
 * decides when an item was ticked.
 */

const { checklist, checklistItem } = schema

/** Leaves room to insert between two rows without renumbering. */
const POSITION_STEP = 10

function listVisibility(workspaceId: string, includeDeleted: boolean): SQL | undefined {
  const scope = eq(checklist.workspaceId, workspaceId)
  return includeDeleted ? scope : and(scope, isNull(checklist.deletedAt))
}

function itemVisibility(workspaceId: string, includeDeleted: boolean): SQL | undefined {
  const scope = eq(checklistItem.workspaceId, workspaceId)
  return includeDeleted ? scope : and(scope, isNull(checklistItem.deletedAt))
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
    throw new ValidationError('Cannot add a checklist to a deleted shoot', 'shootId')
  }
}

async function assertChecklistUsable(tx: TenantDb, workspaceId: string, checklistId: string) {
  const [parent] = await tx
    .select({ deletedAt: checklist.deletedAt })
    .from(checklist)
    .where(and(eq(checklist.id, checklistId), listVisibility(workspaceId, true)))
    .limit(1)

  if (!parent) throw new NotFoundError('Checklist', checklistId)
  if (parent.deletedAt) {
    throw new ValidationError('Cannot add an item to a deleted checklist', 'checklistId')
  }
}

async function nextListPosition(
  tx: TenantDb,
  workspaceId: string,
  shootId: string,
): Promise<number> {
  const [row] = await tx
    .select({ highest: max(checklist.position) })
    .from(checklist)
    .where(and(eq(checklist.shootId, shootId), listVisibility(workspaceId, true)))

  return (row?.highest ?? -POSITION_STEP) + POSITION_STEP
}

async function nextItemPosition(
  tx: TenantDb,
  workspaceId: string,
  checklistId: string,
): Promise<number> {
  const [row] = await tx
    .select({ highest: max(checklistItem.position) })
    .from(checklistItem)
    .where(and(eq(checklistItem.checklistId, checklistId), itemVisibility(workspaceId, true)))

  return (row?.highest ?? -POSITION_STEP) + POSITION_STEP
}

// --- lists ----------------------------------------------------------------

export async function createChecklist(
  db: Database,
  ctx: TenantContext,
  input: CreateChecklistInput,
) {
  return withTenant(db, ctx, async (tx) => {
    await assertShootUsable(tx, ctx.workspaceId, input.shootId)

    const [row] = await tx
      .insert(checklist)
      .values({
        ...(input.id ? { id: input.id } : {}),
        workspaceId: ctx.workspaceId,
        shootId: input.shootId,
        sessionId: input.sessionId ?? null,
        kind: input.kind,
        name: input.name,
        position: input.position ?? (await nextListPosition(tx, ctx.workspaceId, input.shootId)),
        notes: input.notes ?? null,
      })
      .onConflictDoNothing({ target: checklist.id })
      .returning()

    if (row) return row

    // Replayed offline mutation or double submit: return the original.
    const existing = input.id ? await findChecklist(tx, ctx.workspaceId, input.id) : undefined
    if (!existing) throw new NotFoundError('Checklist', input.id)
    return existing
  })
}

async function findChecklist(tx: TenantDb, workspaceId: string, id: string) {
  const [row] = await tx
    .select()
    .from(checklist)
    .where(and(eq(checklist.id, id), listVisibility(workspaceId, true)))
    .limit(1)

  return row
}

/**
 * Lists, each carrying how far through it you are.
 *
 * The counts are computed in the same query rather than left to the caller.
 * A checklist is almost always rendered as "4 of 12", so returning the rows
 * alone would guarantee a fetch per list purely to draw a number — the N+1
 * that writes itself.
 */
export async function listChecklists(db: Database, ctx: TenantContext, input: ListChecklistsInput) {
  return withTenant(db, ctx, async (tx) => {
    const predicates: (SQL | undefined)[] = [listVisibility(ctx.workspaceId, input.includeDeleted)]

    if (input.shootId) predicates.push(eq(checklist.shootId, input.shootId))
    /**
     * `null` is a meaningful filter, not an absent one: it asks for lists
     * belonging to the whole shoot rather than to a session. `undefined` means
     * no session filter at all.
     */
    if (input.sessionId === null) predicates.push(isNull(checklist.sessionId))
    else if (input.sessionId) predicates.push(eq(checklist.sessionId, input.sessionId))
    if (input.kind) predicates.push(eq(checklist.kind, input.kind))
    if (input.updatedSince) predicates.push(gte(checklist.updatedAt, input.updatedSince))
    if (input.cursor) predicates.push(gt(checklist.id, input.cursor))

    /**
     * Deleted items never count, even when `includeDeleted` is asking for
     * deleted *lists* — a tombstoned list still describes how much of it was
     * done, and a crossed-off item is not progress.
     *
     * ---------------------------------------------------------------------
     * Written as literal SQL, deliberately. Do not "tidy" this into Drizzle
     * column references.
     * ---------------------------------------------------------------------
     * Interpolating a column into a `sql` template renders it UNQUALIFIED —
     * `${checklistItem.checklistId}` becomes `"checklist_id"`, not
     * `"checklist_item"."checklist_id"`. Inside a correlated subquery both
     * sides then bind to the inner table, so the obvious-looking version
     * compiles to:
     *
     *     where "checklist_id" = "id" and "workspace_id" = "workspace_id"
     *
     * which asks whether checklist_item.checklist_id equals its own id, and
     * whether its workspace equals itself. It is valid SQL, it never raises,
     * and it silently counts zero — the worst possible failure mode for a
     * progress indicator, because an empty list and a broken query look
     * identical. Caught only because the tests assert real numbers.
     */
    const itemCount = sql<number>`(
      select count(*)::int
        from checklist_item ci
       where ci.checklist_id = checklist.id
         and ci.workspace_id = checklist.workspace_id
         and ci.deleted_at is null
    )`

    const doneCount = sql<number>`(
      select count(*)::int
        from checklist_item ci
       where ci.checklist_id = checklist.id
         and ci.workspace_id = checklist.workspace_id
         and ci.deleted_at is null
         and ci.done_at is not null
    )`

    const rows = await tx
      .select({
        id: checklist.id,
        workspaceId: checklist.workspaceId,
        shootId: checklist.shootId,
        sessionId: checklist.sessionId,
        kind: checklist.kind,
        name: checklist.name,
        position: checklist.position,
        notes: checklist.notes,
        createdAt: checklist.createdAt,
        updatedAt: checklist.updatedAt,
        deletedAt: checklist.deletedAt,
        itemCount,
        doneCount,
      })
      .from(checklist)
      .where(and(...predicates))
      /**
       * Keyset pagination needs a unique, stable sort, and `position` is
       * neither — it repeats across shoots and changes on reorder. Ordering by
       * id keeps the cursor correct; callers render in `position` order, which
       * is cheap for a page of at most 200.
       */
      .orderBy(asc(checklist.id))
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

export async function updateChecklist(
  db: Database,
  ctx: TenantContext,
  input: UpdateChecklistInput,
) {
  const { id, ...patch } = input

  return withTenant(db, ctx, async (tx) => {
    const [row] = await tx
      .update(checklist)
      .set(patch)
      .where(and(eq(checklist.id, id), listVisibility(ctx.workspaceId, false)))
      .returning()

    if (!row) throw new NotFoundError('Checklist', id)
    return row
  })
}

/**
 * Soft-deletes the list and everything on it.
 *
 * The items go too, in the same transaction. Leaving them live would hide
 * them from every list view while still counting them in any future
 * aggregate — orphans that are invisible but not gone.
 */
export async function deleteChecklist(db: Database, ctx: TenantContext, id: string) {
  return withTenant(db, ctx, async (tx) => {
    const deletedAt = new Date()

    const [row] = await tx
      .update(checklist)
      .set({ deletedAt })
      .where(and(eq(checklist.id, id), listVisibility(ctx.workspaceId, false)))
      .returning()

    if (!row) throw new NotFoundError('Checklist', id)

    await tx
      .update(checklistItem)
      .set({ deletedAt })
      .where(and(eq(checklistItem.checklistId, id), itemVisibility(ctx.workspaceId, false)))

    return row
  })
}

// --- items ----------------------------------------------------------------

export async function createChecklistItem(
  db: Database,
  ctx: TenantContext,
  input: CreateChecklistItemInput,
) {
  return withTenant(db, ctx, async (tx) => {
    await assertChecklistUsable(tx, ctx.workspaceId, input.checklistId)

    const [row] = await tx
      .insert(checklistItem)
      .values({
        ...(input.id ? { id: input.id } : {}),
        workspaceId: ctx.workspaceId,
        checklistId: input.checklistId,
        label: input.label,
        quantity: input.quantity ?? 1,
        position:
          input.position ?? (await nextItemPosition(tx, ctx.workspaceId, input.checklistId)),
        notes: input.notes ?? null,
      })
      .onConflictDoNothing({ target: checklistItem.id })
      .returning()

    if (row) return row

    const existing = input.id ? await findChecklistItem(tx, ctx.workspaceId, input.id) : undefined
    if (!existing) throw new NotFoundError('Checklist item', input.id)
    return existing
  })
}

async function findChecklistItem(tx: TenantDb, workspaceId: string, id: string) {
  const [row] = await tx
    .select()
    .from(checklistItem)
    .where(and(eq(checklistItem.id, id), itemVisibility(workspaceId, true)))
    .limit(1)

  return row
}

/**
 * Add several lines at once.
 *
 * Checklists are written in bursts — someone types a packing list from memory
 * in one sitting — and a request per line would make that feel like filling in
 * a form forty times.
 */
export async function addChecklistItems(
  db: Database,
  ctx: TenantContext,
  input: AddChecklistItemsInput,
) {
  return withTenant(db, ctx, async (tx) => {
    await assertChecklistUsable(tx, ctx.workspaceId, input.checklistId)

    const start = await nextItemPosition(tx, ctx.workspaceId, input.checklistId)

    return tx
      .insert(checklistItem)
      .values(
        input.labels.map((label, index) => ({
          workspaceId: ctx.workspaceId,
          checklistId: input.checklistId,
          label,
          position: start + index * POSITION_STEP,
        })),
      )
      .returning()
  })
}

export async function updateChecklistItem(
  db: Database,
  ctx: TenantContext,
  input: UpdateChecklistItemInput,
) {
  const { id, ...patch } = input

  return withTenant(db, ctx, async (tx) => {
    const [row] = await tx
      .update(checklistItem)
      .set(patch)
      .where(and(eq(checklistItem.id, id), itemVisibility(ctx.workspaceId, false)))
      .returning()

    if (!row) throw new NotFoundError('Checklist item', id)
    return row
  })
}

/**
 * Tick or untick an item.
 *
 * The caller says *whether*; the server decides *when*, from the transaction
 * clock. A client-supplied timestamp would let a phone with a wrong clock
 * record that the batteries were packed tomorrow, and "packed at 04:52" is
 * only worth storing if it is true.
 *
 * Ticking an already-ticked item deliberately does not move the timestamp:
 * the first time it was done is the fact worth keeping.
 */
export async function setChecklistItemDone(
  db: Database,
  ctx: TenantContext,
  input: SetChecklistItemDoneInput,
) {
  return withTenant(db, ctx, async (tx) => {
    const [row] = await tx
      .update(checklistItem)
      .set({
        doneAt: input.done ? sql`coalesce(${checklistItem.doneAt}, transaction_timestamp())` : null,
      })
      .where(and(eq(checklistItem.id, input.id), itemVisibility(ctx.workspaceId, false)))
      .returning()

    if (!row) throw new NotFoundError('Checklist item', input.id)
    return row
  })
}

export async function listChecklistItems(
  db: Database,
  ctx: TenantContext,
  input: ListChecklistItemsInput,
) {
  return withTenant(db, ctx, async (tx) => {
    const predicates: (SQL | undefined)[] = [itemVisibility(ctx.workspaceId, input.includeDeleted)]

    if (input.checklistId) predicates.push(eq(checklistItem.checklistId, input.checklistId))
    if (input.updatedSince) predicates.push(gte(checklistItem.updatedAt, input.updatedSince))
    if (input.cursor) predicates.push(gt(checklistItem.id, input.cursor))

    const rows = await tx
      .select()
      .from(checklistItem)
      .where(and(...predicates))
      .orderBy(asc(checklistItem.id))
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

export async function deleteChecklistItem(db: Database, ctx: TenantContext, id: string) {
  return withTenant(db, ctx, async (tx) => {
    const [row] = await tx
      .update(checklistItem)
      .set({ deletedAt: new Date() })
      .where(and(eq(checklistItem.id, id), itemVisibility(ctx.workspaceId, false)))
      .returning()

    if (!row) throw new NotFoundError('Checklist item', id)
    return row
  })
}

/**
 * Rewrite the order of a list's items in one transaction.
 *
 * Every id must belong to this checklist, and the caller must list all of its
 * live items. Accepting a partial list would silently leave the omitted items
 * interleaved at stale positions, which looks like the drag "didn't take" —
 * and is far harder to diagnose than a rejected request.
 */
export async function reorderChecklistItems(
  db: Database,
  ctx: TenantContext,
  input: ReorderChecklistItemsInput,
): Promise<{ reordered: number }> {
  return withTenant(db, ctx, async (tx) => {
    await assertChecklistUsable(tx, ctx.workspaceId, input.checklistId)

    const unique = new Set(input.orderedIds)
    if (unique.size !== input.orderedIds.length) {
      throw new ValidationError('The same item was listed more than once', 'orderedIds')
    }

    const live = await tx
      .select({ id: checklistItem.id })
      .from(checklistItem)
      .where(
        and(
          eq(checklistItem.checklistId, input.checklistId),
          itemVisibility(ctx.workspaceId, false),
        ),
      )

    const liveIds = new Set(live.map((row) => row.id))

    const unknown = input.orderedIds.find((id) => !liveIds.has(id))
    if (unknown) throw new NotFoundError('Checklist item', unknown)

    if (liveIds.size !== unique.size) {
      throw new ValidationError(
        `Reordering must list every item on the checklist (expected ${liveIds.size}, got ${unique.size})`,
        'orderedIds',
      )
    }

    /**
     * One UPDATE ... FROM (VALUES ...) rather than a statement per item. A
     * forty-line packing list would otherwise be forty round trips inside the
     * transaction, holding row locks the whole way.
     */
    const values = sql.join(
      input.orderedIds.map((id, index) => sql`(${id}::uuid, ${index * POSITION_STEP}::integer)`),
      sql`, `,
    )

    await tx.execute(sql`
      update ${checklistItem} as ci
         set position = v.position
        from (values ${values}) as v(id, position)
       where ci.id = v.id
         and ci.workspace_id = ${ctx.workspaceId}::uuid
    `)

    return { reordered: input.orderedIds.length }
  })
}
