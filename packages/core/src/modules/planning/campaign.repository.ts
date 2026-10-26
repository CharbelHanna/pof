import { and, asc, eq, gt, gte, isNull, sql, type SQL } from 'drizzle-orm'
import { schema, type TenantDb } from '@pof/db'

import type { ListCampaignsInput } from '@pof/schemas'

const { campaign } = schema

function visibility(workspaceId: string, includeDeleted: boolean): SQL | undefined {
  const scope = eq(campaign.workspaceId, workspaceId)
  return includeDeleted ? scope : and(scope, isNull(campaign.deletedAt))
}

export async function insertCampaign(
  tx: TenantDb,
  workspaceId: string,
  values: {
    id?: string | undefined
    name: string
    brief?: string | undefined
    status: (typeof schema.campaign.$inferInsert)['status']
    startsOn?: string | null | undefined
    endsOn?: string | null | undefined
  },
) {
  const [row] = await tx
    .insert(campaign)
    .values({
      ...(values.id ? { id: values.id } : {}),
      workspaceId,
      name: values.name,
      brief: values.brief ?? null,
      status: values.status,
      startsOn: values.startsOn ?? null,
      endsOn: values.endsOn ?? null,
    })
    // Idempotent create, so a replayed offline mutation or a double submit
    // resolves to the same row rather than a duplicate.
    .onConflictDoNothing({ target: campaign.id })
    .returning()

  return row
}

export async function findCampaignById(tx: TenantDb, workspaceId: string, id: string) {
  const [row] = await tx
    .select()
    .from(campaign)
    .where(and(eq(campaign.id, id), visibility(workspaceId, true)))
    .limit(1)

  return row
}

export async function listCampaigns(tx: TenantDb, workspaceId: string, input: ListCampaignsInput) {
  const predicates: (SQL | undefined)[] = [visibility(workspaceId, input.includeDeleted)]

  if (input.cursor) predicates.push(gt(campaign.id, input.cursor))
  if (input.updatedSince) predicates.push(gte(campaign.updatedAt, input.updatedSince))

  const rows = await tx
    .select()
    .from(campaign)
    .where(and(...predicates))
    .orderBy(asc(campaign.id))
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

export async function updateCampaign(
  tx: TenantDb,
  workspaceId: string,
  id: string,
  patch: Record<string, unknown>,
) {
  const [row] = await tx
    .update(campaign)
    .set(patch)
    .where(and(eq(campaign.id, id), visibility(workspaceId, false)))
    .returning()

  return row
}

export async function softDeleteCampaign(tx: TenantDb, workspaceId: string, id: string) {
  const [row] = await tx
    .update(campaign)
    .set({ deletedAt: new Date() })
    .where(and(eq(campaign.id, id), visibility(workspaceId, false)))
    .returning()

  return row
}
