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
  return (await resolveViewer(headers))?.session ?? null
}

/**
 * Who is signed in, as well as what they may act on.
 *
 * `AuthenticatedSession` is the tenant scope and stays deliberately minimal —
 * a user id and a workspace id, nothing a query could accidentally leak. But
 * the chrome has to show *which account* this is, and a second `getSession`
 * call to fetch a name would mean a second database round trip on every page.
 *
 * So one function resolves both, and `resolveSession` is the narrow view of
 * it. Callers that only scope data keep taking the narrow type.
 */
export async function resolveViewer(headers: Headers): Promise<{
  session: AuthenticatedSession
  user: { name: string; email: string }
} | null> {
  const session = await getAuth().api.getSession({ headers })
  if (!session?.user?.id) return null

  const userId = session.user.id
  const workspaceId = await ensureWorkspaceForUser(
    getDb(),
    userId,
    // Passed through, but only honoured if membership checks out.
    session.session?.activeOrganizationId,
  )

  return {
    session: { userId, workspaceId },
    user: {
      // Name is optional at the database level; the email always exists and
      // is what actually identifies the account.
      name: session.user.name?.trim() || session.user.email,
      email: session.user.email,
    },
  }
}
