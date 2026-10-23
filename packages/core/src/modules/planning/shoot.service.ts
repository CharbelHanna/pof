import { withTenant, type Database, type TenantContext } from '@pof/db'
import type { CreateShootInput, ListShootsInput, UpdateShootInput } from '@pof/schemas'

import { NotFoundError } from '../../errors.ts'
import { assertWithin } from '../identity/entitlements.ts'
import * as repo from './shoot.repository.ts'

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
    const created = await repo.insertShoot(tx, ctx.workspaceId, {
      id: input.id,
      name: input.name,
      shootTypeKey: input.shootTypeKey,
      status: input.status,
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
  const { id, ...patch } = input

  return withTenant(db, ctx, async (tx) => {
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
