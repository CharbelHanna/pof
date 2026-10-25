import 'server-only'

import type { AuthenticatedSession } from '@pof/api'
import { ensureWorkspaceForUser } from '@pof/core'

import { getAuth } from './auth.ts'
import { getDb } from './db.ts'

/**
 * Turn an incoming request into a verified workspace scope.
 *
 * This is the only place a session becomes a tenant, so there is exactly one
 * path by which a request becomes workspace-scoped.
 *
 * The rule that matters lives in `@pof/core` (`findWorkspaceForUser`): the
 * workspace is resolved by querying `member`, and the client's requested
 * active organization is honoured only after membership is confirmed. It is a
 * request, not a fact — trusting it outright would be the easiest
 * cross-tenant read to introduce.
 */
export async function resolveSession(headers: Headers): Promise<AuthenticatedSession | null> {
  const session = await getAuth().api.getSession({ headers })
  if (!session?.user?.id) return null

  const userId = session.user.id
  const workspaceId = await ensureWorkspaceForUser(
    getDb(),
    userId,
    // Passed through, but only honoured if membership checks out.
    session.session?.activeOrganizationId,
  )

  return { userId, workspaceId }
}
