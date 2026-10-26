import { withTenant, type Database, type TenantContext } from '@pof/db'
import type { CreateCampaignInput, ListCampaignsInput, UpdateCampaignInput } from '@pof/schemas'

import { NotFoundError } from '../../errors.ts'
import { assertWithin } from '../identity/entitlements.ts'
import * as repo from './campaign.repository.ts'

/**
 * Campaign business rules.
 *
 * A campaign groups shoots, optionally. Deleting one deliberately does NOT
 * delete its shoots — the composite foreign key is `ON DELETE SET NULL`,
 * because losing a shoot means losing real planning work whereas losing its
 * grouping is an inconvenience.
 */

export async function createCampaign(db: Database, ctx: TenantContext, input: CreateCampaignInput) {
  await assertWithin(ctx, 'shoots')

  return withTenant(db, ctx, async (tx) => {
    const created = await repo.insertCampaign(tx, ctx.workspaceId, input)
    if (created) return created

    // The id already existed: a replayed offline mutation or a double submit.
    // Return the original so the operation is genuinely idempotent.
    const existing = input.id
      ? await repo.findCampaignById(tx, ctx.workspaceId, input.id)
      : undefined
    if (!existing) throw new NotFoundError('Campaign', input.id)
    return existing
  })
}

export async function listCampaigns(db: Database, ctx: TenantContext, input: ListCampaignsInput) {
  return withTenant(db, ctx, (tx) => repo.listCampaigns(tx, ctx.workspaceId, input))
}

export async function getCampaign(db: Database, ctx: TenantContext, id: string) {
  return withTenant(db, ctx, async (tx) => {
    const found = await repo.findCampaignById(tx, ctx.workspaceId, id)
    if (!found) throw new NotFoundError('Campaign', id)
    return found
  })
}

export async function updateCampaign(db: Database, ctx: TenantContext, input: UpdateCampaignInput) {
  const { id, ...patch } = input

  return withTenant(db, ctx, async (tx) => {
    const updated = await repo.updateCampaign(tx, ctx.workspaceId, id, patch)

    // Another workspace's row is invisible here, so the caller cannot tell
    // "does not exist" from "belongs to someone else" — which is the correct
    // answer to give them.
    if (!updated) throw new NotFoundError('Campaign', id)
    return updated
  })
}

export async function deleteCampaign(db: Database, ctx: TenantContext, id: string) {
  return withTenant(db, ctx, async (tx) => {
    const deleted = await repo.softDeleteCampaign(tx, ctx.workspaceId, id)
    if (!deleted) throw new NotFoundError('Campaign', id)
    return deleted
  })
}
