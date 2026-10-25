import { schema, type Database } from '@pof/db'
import { newId } from '@pof/schemas'
import { and, eq } from 'drizzle-orm'

/**
 * Resolving a user to the workspace they may act in.
 *
 * Lives in `@pof/core`, not in the web app: it is a business rule, and the
 * Expo app and any future public API need exactly the same one. Duplicating
 * it in an adapter is how two slightly different answers to "which workspace
 * is this?" eventually appear.
 *
 * These functions query `organization`/`member` directly rather than through
 * `withTenant`, which is correct and deliberate: they run BEFORE a tenant
 * context exists — they are what produces one. Those tables carry no RLS
 * policy for the same reason (see packages/db/src/schema/auth.ts).
 */

/**
 * The workspace this user may act in.
 *
 * `requestedWorkspaceId` is whatever the client asked for — typically
 * `session.activeOrganizationId`. It is treated as a REQUEST, never a fact:
 * it is honoured only after confirming membership. Skipping that check would
 * let any signed-in user name another workspace's id and have every
 * downstream query, and the RLS policy itself, scope to it.
 */
export async function findWorkspaceForUser(
  db: Database,
  userId: string,
  requestedWorkspaceId?: string | null,
): Promise<string | undefined> {
  if (requestedWorkspaceId) {
    const [confirmed] = await db
      .select({ organizationId: schema.member.organizationId })
      .from(schema.member)
      .where(
        and(
          eq(schema.member.userId, userId),
          eq(schema.member.organizationId, requestedWorkspaceId),
        ),
      )
      .limit(1)

    if (confirmed) return confirmed.organizationId
    // Fall through rather than throwing: a stale active-organization cookie
    // after leaving a workspace is an ordinary state, not an attack.
  }

  const [membership] = await db
    .select({ organizationId: schema.member.organizationId })
    .from(schema.member)
    .where(eq(schema.member.userId, userId))
    .limit(1)

  return membership?.organizationId
}

/**
 * Ensure the user has a workspace, creating one if not.
 *
 * V1 gives every photographer exactly one. Provisioning lazily on first
 * authenticated request rather than in a signup hook means users created by
 * any route — the web form, a seed script, a future social login — converge
 * to a valid state without each route remembering to do it.
 */
export async function ensureWorkspaceForUser(
  db: Database,
  userId: string,
  requestedWorkspaceId?: string | null,
): Promise<string> {
  const existing = await findWorkspaceForUser(db, userId, requestedWorkspaceId)
  if (existing) return existing

  const workspaceId = newId()
  // Derived from the user id so that two concurrent first requests collide on
  // the unique slug instead of creating two workspaces for one person.
  const slug = `ws-${userId.replaceAll('-', '').slice(0, 12)}`

  try {
    await db.insert(schema.organization).values({ id: workspaceId, name: 'My Studio', slug })
    await db.insert(schema.member).values({
      id: newId(),
      organizationId: workspaceId,
      userId,
      role: 'owner',
    })
    return workspaceId
  } catch {
    // Lost the race, or recovering from a partial earlier attempt.
    const winner = await findWorkspaceForUser(db, userId)
    if (winner) return winner
    throw new Error(`Could not provision a workspace for user ${userId}`)
  }
}
