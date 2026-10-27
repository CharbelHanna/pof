import { withTenant, type Database, type TenantContext, type TenantDb } from '@pof/db'
import {
  currentDetailsVersion,
  parseShootDetails,
  safeParseShootDetails,
  type CreateShootInput,
  type ListShootsInput,
  type UpdateShootInput,
} from '@pof/schemas'

import { NotFoundError, ValidationError } from '../../errors.ts'
import { assertWithin } from '../identity/entitlements.ts'
import * as campaignRepo from './campaign.repository.ts'
import * as repo from './shoot.repository.ts'

/**
 * Confirm a campaign exists in this workspace before linking a shoot to it.
 *
 * The composite foreign key already makes a cross-workspace link impossible,
 * but it surfaces as an opaque constraint violation. Checking first turns that
 * into a clean "not found" — and, because another workspace's campaign is
 * invisible here, the caller cannot distinguish "does not exist" from "is not
 * yours", which is the right answer to give them.
 */
async function assertCampaignUsable(
  tx: TenantDb,
  workspaceId: string,
  campaignId: string | null | undefined,
): Promise<void> {
  if (!campaignId) return

  const parent = await campaignRepo.findCampaignById(tx, workspaceId, campaignId)
  if (!parent) throw new NotFoundError('Campaign', campaignId)
  if (parent.deletedAt) {
    throw new ValidationError('Cannot attach a shoot to a deleted campaign', 'campaignId')
  }
}

/**
 * Shoot business rules.
 *
 * This is where behaviour lives — not in a route handler, not in a server
 * action, not in an oRPC procedure. Those are adapters. Keeping logic here is
 * what lets the web UI, the Phase 8 Expo app and any future public API reach
 * identical behaviour through one path, and what makes swapping the transport
 * (if oRPC ever stops being the right bet) a day's work instead of a rewrite.
 *
 * Every function opens its own tenant transaction. Callers pass a verified
 * `TenantContext`; they never get a database handle.
 */

export async function createShoot(db: Database, ctx: TenantContext, input: CreateShootInput) {
  // No-op today. The call site is the point — see entitlements.ts.
  await assertWithin(ctx, 'shoots')

  return withTenant(db, ctx, async (tx) => {
    await assertCampaignUsable(tx, ctx.workspaceId, input.campaignId)

    const created = await repo.insertShoot(tx, ctx.workspaceId, {
      id: input.id,
      name: input.name,
      shootTypeKey: input.shootTypeKey,
      status: input.status,
      campaignId: input.campaignId ?? null,
      deliveryDate: input.deliveryDate ?? null,
      /**
       * Validated against the genre's definition here, not in the input
       * schema — the correct shape depends on `shootTypeKey`, a sibling
       * field, which a field-level schema cannot see. Throws a ZodError that
       * the API layer maps to a 400.
       */
      details: parseShootDetails(input.shootTypeKey, input.details),
      detailsSchemaVersion: currentDetailsVersion(input.shootTypeKey),
      notes: input.notes,
    })

    // `undefined` means this id already existed: a replayed offline mutation
    // or a double submit. Return the original row so the operation is
    // genuinely idempotent rather than merely not-crashing.
    if (created) return created

    const existing = input.id ? await repo.findShootById(tx, ctx.workspaceId, input.id) : undefined
    if (!existing) throw new NotFoundError('Shoot', input.id)
    return existing
  })
}

export async function listShoots(db: Database, ctx: TenantContext, input: ListShootsInput) {
  return withTenant(db, ctx, (tx) => repo.listShoots(tx, ctx.workspaceId, input))
}

export async function getShoot(db: Database, ctx: TenantContext, id: string) {
  return withTenant(db, ctx, async (tx) => {
    const found = await repo.findShootById(tx, ctx.workspaceId, id)
    if (!found) throw new NotFoundError('Shoot', id)
    return found
  })
}

export async function updateShoot(db: Database, ctx: TenantContext, input: UpdateShootInput) {
  const { id, details, ...rest } = input

  return withTenant(db, ctx, async (tx) => {
    await assertCampaignUsable(tx, ctx.workspaceId, input.campaignId)

    const patch: Record<string, unknown> = { ...rest }

    /**
     * `details` has to be re-validated whenever either it OR the genre
     * changes, because its valid shape is defined by the genre.
     *
     * Switching an editorial shoot to product and keeping `{publication}`
     * would leave a field no form renders and no schema accepts — invisible
     * clutter that fails validation on the next unrelated edit. Re-parsing
     * against the new genre strips it, which is what "this is a product shoot
     * now" means.
     */
    const changingGenre = rest.shootTypeKey !== undefined
    if (details !== undefined || changingGenre) {
      const current = await repo.findShootById(tx, ctx.workspaceId, id)
      if (!current) throw new NotFoundError('Shoot', id)

      const genre = rest.shootTypeKey ?? current.shootTypeKey
      const payload = details ?? (current.details as Record<string, unknown>)

      // Not `parseShootDetails`: carrying a payload across a genre change
      // should drop what no longer applies, not reject the whole edit.
      patch.details =
        changingGenre && details === undefined
          ? safeParseShootDetails(genre, payload)
          : parseShootDetails(genre, payload)
      patch.detailsSchemaVersion = currentDetailsVersion(genre)
    }

    const updated = await repo.updateShoot(tx, ctx.workspaceId, id, patch)

    // A row belonging to another workspace is invisible here — RLS filters it
    // before the UPDATE matches anything. The caller therefore cannot
    // distinguish "does not exist" from "belongs to someone else", which is
    // the correct answer to give them.
    if (!updated) throw new NotFoundError('Shoot', id)
    return updated
  })
}

export async function deleteShoot(db: Database, ctx: TenantContext, id: string) {
  return withTenant(db, ctx, async (tx) => {
    const deleted = await repo.softDeleteShoot(tx, ctx.workspaceId, id)
    if (!deleted) throw new NotFoundError('Shoot', id)
    return deleted
  })
}
