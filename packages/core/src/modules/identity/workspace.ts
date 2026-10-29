import { schema, type Database } from '@pof/db'
import { newId } from '@pof/schemas'
import { and, eq, sql } from 'drizzle-orm'

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

/** The query interface, satisfied by both a connection and a transaction. */
type Queryable = Pick<Database, 'select' | 'insert' | 'execute'>

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
  db: Queryable,
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
 *
 * ---------------------------------------------------------------------------
 * Why this is a transaction holding an advisory lock
 * ---------------------------------------------------------------------------
 * A newly signed-up user's first page load fires many requests in parallel —
 * the shoot page alone queries the shoot, the genre list, campaigns,
 * sessions, crew, gear, the gear library and locations. Every one of them
 * resolves a session, so every one of them tries to provision.
 *
 * An earlier version inserted the organization and the membership as two
 * separate statements, catching the slug conflict and re-reading. That failed
 * in two ways:
 *
 *   - Not atomic. Between the two inserts the organization exists with no
 *     member. A crash there left the user permanently stuck: the slug is
 *     taken, so every later attempt conflicts, and the re-read finds no
 *     membership. Not a race but a one-way trap.
 *   - Not serialised. The losers re-read before the winner had committed its
 *     membership row, found nothing, and threw
 *     "Could not provision a workspace".
 *
 * `pg_advisory_xact_lock` serialises provisioning per user and releases on
 * commit or rollback, so the check and the create are one atomic step and
 * waiters observe the finished result rather than a half-built one.
 */
export async function ensureWorkspaceForUser(
  db: Database,
  userId: string,
  requestedWorkspaceId?: string | null,
): Promise<string> {
  // Fast path: almost every request belongs to a user who already has one,
  // and should not pay for a lock.
  const existing = await findWorkspaceForUser(db, userId, requestedWorkspaceId)
  if (existing) return existing

  return db.transaction(async (tx) => {
    /**
     * Serialise on the user id. `hashtext` reduces it to the bigint the lock
     * API takes; a collision between two different users would only mean one
     * briefly waiting for the other, never an incorrect result, because the
     * membership check inside the lock is still by user id.
     */
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`)

    // Re-check inside the lock: another request may have provisioned while
    // this one waited, and its work is committed and visible by now.
    const winner = await findWorkspaceForUser(tx as Queryable, userId)
    if (winner) return winner

    const workspaceId = newId()
    // Derived from the user id so a retry after a failure reuses the same
    // slug rather than littering the table with abandoned ones.
    const slug = `ws-${userId.replaceAll('-', '').slice(0, 12)}`

    await tx
      .insert(schema.organization)
      .values({ id: workspaceId, name: 'My Studio', slug })
      /**
       * Tolerates the organization already existing from an earlier attempt
       * that failed before writing the membership — the exact trap described
       * above. The membership insert below then completes it.
       */
      .onConflictDoNothing({ target: schema.organization.slug })

    const [organization] = await tx
      .select({ id: schema.organization.id })
      .from(schema.organization)
      .where(eq(schema.organization.slug, slug))
      .limit(1)

    if (!organization) {
      throw new Error(`Could not provision a workspace for user ${userId}`)
    }

    await tx
      .insert(schema.member)
      .values({
        id: newId(),
        organizationId: organization.id,
        userId,
        role: 'owner',
      })
      /**
       * Targets the unique index on (organization_id, user_id), not the
       * primary key — the id here is freshly generated and could never
       * conflict, so a bare `onConflictDoNothing()` would guard nothing.
       */
      .onConflictDoNothing({
        target: [schema.member.organizationId, schema.member.userId],
      })

    return organization.id
  })
}
