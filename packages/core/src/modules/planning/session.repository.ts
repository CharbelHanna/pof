import { and, asc, eq, gt, gte, isNull, lte, sql, type SQL } from 'drizzle-orm'
import { schema, type TenantDb } from '@pof/db'

import type { ListSessionsInput } from '@pof/schemas'

const { shootSession } = schema

function visibility(workspaceId: string, includeDeleted: boolean): SQL | undefined {
  const scope = eq(shootSession.workspaceId, workspaceId)
  return includeDeleted ? scope : and(scope, isNull(shootSession.deletedAt))
}

export async function insertSession(
  tx: TenantDb,
  workspaceId: string,
  values: {
    id?: string | undefined
    shootId: string
    name: string
    status: (typeof schema.shootSession.$inferInsert)['status']
    startsAt: Date
    endsAt: Date
    timezone: string
    notes?: string | undefined
  },
) {
  const [row] = await tx
    .insert(shootSession)
    .values({
      ...(values.id ? { id: values.id } : {}),
      workspaceId,
      shootId: values.shootId,
      name: values.name,
      status: values.status,
      startsAt: values.startsAt,
      endsAt: values.endsAt,
      timezone: values.timezone,
      notes: values.notes ?? null,
    })
    .onConflictDoNothing({ target: shootSession.id })
    .returning()

  return row
}

export async function findSessionById(tx: TenantDb, workspaceId: string, id: string) {
  const [row] = await tx
    .select()
    .from(shootSession)
    .where(and(eq(shootSession.id, id), visibility(workspaceId, true)))
    .limit(1)

  return row
}

export async function listSessions(tx: TenantDb, workspaceId: string, input: ListSessionsInput) {
  const predicates: (SQL | undefined)[] = [visibility(workspaceId, input.includeDeleted)]

  if (input.shootId) predicates.push(eq(shootSession.shootId, input.shootId))

  /**
   * Window for the calendar and agenda views.
   *
   * Compared against `startsAt`, so a session is included when it BEGINS in
   * the window. A long session that started before `from` is excluded — which
   * is what a day view wants, and what an agenda list wants. A true overlap
   * query (`startsAt < until AND endsAt > from`) would be the right thing for
   * a resource-scheduling view, and can be added when such a view exists.
   */
  if (input.from) predicates.push(gte(shootSession.startsAt, input.from))
  if (input.until) predicates.push(lte(shootSession.startsAt, input.until))

  if (input.updatedSince) predicates.push(gte(shootSession.updatedAt, input.updatedSince))
  if (input.cursor) predicates.push(gt(shootSession.id, input.cursor))

  const rows = await tx
    .select()
    .from(shootSession)
    .where(and(...predicates))
    .orderBy(asc(shootSession.id))
    .limit(input.limit + 1)

  const [clock] = await tx.execute<{ now: string }>(sql`select transaction_timestamp() as now`)

  const hasMore = rows.length > input.limit
  const page = hasMore ? rows.slice(0, input.limit) : rows

  return {
    items: page,
    nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
    syncedAt: new Date(clock!.now),
  }
}

export async function updateSession(
  tx: TenantDb,
  workspaceId: string,
  id: string,
  patch: Record<string, unknown>,
) {
  const [row] = await tx
    .update(shootSession)
    .set(patch)
    .where(and(eq(shootSession.id, id), visibility(workspaceId, false)))
    .returning()

  return row
}

export async function softDeleteSession(tx: TenantDb, workspaceId: string, id: string) {
  const [row] = await tx
    .update(shootSession)
    .set({ deletedAt: new Date() })
    .where(and(eq(shootSession.id, id), visibility(workspaceId, false)))
    .returning()

  return row
}
