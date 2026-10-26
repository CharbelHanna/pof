import { withTenant, type Database, type TenantContext } from '@pof/db'
import type { CreateSessionInput, ListSessionsInput, UpdateSessionInput } from '@pof/schemas'

import { NotFoundError, ValidationError } from '../../errors.ts'
import { assertWithin } from '../identity/entitlements.ts'
import * as shootRepo from './shoot.repository.ts'
import * as repo from './session.repository.ts'

/**
 * Session business rules.
 *
 * Sessions hang off a shoot. The composite foreign key means the database
 * already refuses a session attached to another workspace's shoot — but a
 * foreign-key violation is an opaque 500 to a user, so the parent is checked
 * explicitly first and reported as a clean "not found".
 */

export async function createSession(db: Database, ctx: TenantContext, input: CreateSessionInput) {
  await assertWithin(ctx, 'sessions')

  return withTenant(db, ctx, async (tx) => {
    const parent = await shootRepo.findShootById(tx, ctx.workspaceId, input.shootId)
    if (!parent) throw new NotFoundError('Shoot', input.shootId)
    if (parent.deletedAt) {
      throw new ValidationError('Cannot add a session to a deleted shoot', 'shootId')
    }

    const created = await repo.insertSession(tx, ctx.workspaceId, input)
    if (created) return created

    const existing = input.id
      ? await repo.findSessionById(tx, ctx.workspaceId, input.id)
      : undefined
    if (!existing) throw new NotFoundError('Session', input.id)
    return existing
  })
}

export async function listSessions(db: Database, ctx: TenantContext, input: ListSessionsInput) {
  return withTenant(db, ctx, (tx) => repo.listSessions(tx, ctx.workspaceId, input))
}

export async function getSession(db: Database, ctx: TenantContext, id: string) {
  return withTenant(db, ctx, async (tx) => {
    const found = await repo.findSessionById(tx, ctx.workspaceId, id)
    if (!found) throw new NotFoundError('Session', id)
    return found
  })
}

export async function updateSession(db: Database, ctx: TenantContext, input: UpdateSessionInput) {
  const { id, ...patch } = input

  return withTenant(db, ctx, async (tx) => {
    /**
     * A partial update can break the start/end ordering in a way the input
     * schema cannot see: moving only `startsAt` past the stored `endsAt` is
     * valid in isolation but invalid against the row.
     *
     * Checked here against the current values so the user gets a field-level
     * message, rather than the database CHECK firing as an opaque error.
     */
    if (patch.startsAt || patch.endsAt) {
      const current = await repo.findSessionById(tx, ctx.workspaceId, id)
      if (!current) throw new NotFoundError('Session', id)

      const startsAt = patch.startsAt ?? current.startsAt
      const endsAt = patch.endsAt ?? current.endsAt

      if (endsAt <= startsAt) {
        throw new ValidationError('The session must end after it starts', 'endsAt')
      }
    }

    const updated = await repo.updateSession(tx, ctx.workspaceId, id, patch)
    if (!updated) throw new NotFoundError('Session', id)
    return updated
  })
}

export async function deleteSession(db: Database, ctx: TenantContext, id: string) {
  return withTenant(db, ctx, async (tx) => {
    const deleted = await repo.softDeleteSession(tx, ctx.workspaceId, id)
    if (!deleted) throw new NotFoundError('Session', id)
    return deleted
  })
}
