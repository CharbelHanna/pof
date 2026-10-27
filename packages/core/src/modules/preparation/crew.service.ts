import { and, asc, eq, gt, gte, isNull, sql, type SQL } from 'drizzle-orm'
import { schema, withTenant, type Database, type TenantContext, type TenantDb } from '@pof/db'
import type { CreateCrewMemberInput, ListCrewInput, UpdateCrewMemberInput } from '@pof/schemas'

import { NotFoundError, ValidationError } from '../../errors.ts'
import * as shootRepo from '../planning/shoot.repository.ts'

/**
 * Crew on a shoot.
 *
 * Repository and service are one file here: crew has no behaviour beyond
 * scoped CRUD and a parent check. Splitting it into the two-file shape the
 * planning module uses would be structure for its own sake — that split earns
 * its keep where there are real rules to separate from queries, which is not
 * the case yet.
 */

const { crewMember } = schema

function visibility(workspaceId: string, includeDeleted: boolean): SQL | undefined {
  const scope = eq(crewMember.workspaceId, workspaceId)
  return includeDeleted ? scope : and(scope, isNull(crewMember.deletedAt))
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
    throw new ValidationError('Cannot add crew to a deleted shoot', 'shootId')
  }
}

export async function createCrewMember(
  db: Database,
  ctx: TenantContext,
  input: CreateCrewMemberInput,
) {
  return withTenant(db, ctx, async (tx) => {
    await assertShootUsable(tx, ctx.workspaceId, input.shootId)

    const [row] = await tx
      .insert(crewMember)
      .values({
        ...(input.id ? { id: input.id } : {}),
        workspaceId: ctx.workspaceId,
        shootId: input.shootId,
        sessionId: input.sessionId ?? null,
        role: input.role,
        name: input.name ?? null,
        notes: input.notes ?? null,
      })
      .onConflictDoNothing({ target: crewMember.id })
      .returning()

    if (row) return row

    // Replayed offline mutation or double submit: return the original.
    const existing = input.id ? await findCrewMember(tx, ctx.workspaceId, input.id) : undefined
    if (!existing) throw new NotFoundError('Crew member', input.id)
    return existing
  })
}

async function findCrewMember(tx: TenantDb, workspaceId: string, id: string) {
  const [row] = await tx
    .select()
    .from(crewMember)
    .where(and(eq(crewMember.id, id), visibility(workspaceId, true)))
    .limit(1)

  return row
}

export async function listCrew(db: Database, ctx: TenantContext, input: ListCrewInput) {
  return withTenant(db, ctx, async (tx) => {
    const predicates: (SQL | undefined)[] = [visibility(ctx.workspaceId, input.includeDeleted)]

    if (input.shootId) predicates.push(eq(crewMember.shootId, input.shootId))
    if (input.updatedSince) predicates.push(gte(crewMember.updatedAt, input.updatedSince))
    if (input.cursor) predicates.push(gt(crewMember.id, input.cursor))

    const rows = await tx
      .select()
      .from(crewMember)
      .where(and(...predicates))
      .orderBy(asc(crewMember.id))
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

export async function updateCrewMember(
  db: Database,
  ctx: TenantContext,
  input: UpdateCrewMemberInput,
) {
  const { id, ...patch } = input

  return withTenant(db, ctx, async (tx) => {
    const [row] = await tx
      .update(crewMember)
      .set(patch)
      .where(and(eq(crewMember.id, id), visibility(ctx.workspaceId, false)))
      .returning()

    if (!row) throw new NotFoundError('Crew member', id)
    return row
  })
}

export async function deleteCrewMember(db: Database, ctx: TenantContext, id: string) {
  return withTenant(db, ctx, async (tx) => {
    const [row] = await tx
      .update(crewMember)
      .set({ deletedAt: new Date() })
      .where(and(eq(crewMember.id, id), visibility(ctx.workspaceId, false)))
      .returning()

    if (!row) throw new NotFoundError('Crew member', id)
    return row
  })
}
