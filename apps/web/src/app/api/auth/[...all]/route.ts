import { getAuth } from '~/lib/auth.ts'

/**
 * Better Auth's endpoints: sign-up, sign-in, sign-out, session, organization.
 *
 * Node runtime, never Edge. The Edge runtime is a platform-shaped abstraction
 * and `postgres`, `drizzle` and Better Auth's crypto do not run there — using
 * it would also tie deployment to hosts that provide it.
 */
export const runtime = 'nodejs'

/**
 * `getAuth()` is called per request, not at module scope. Building the auth
 * instance eagerly would validate the environment while Next collects page
 * data at build time — so a production image could not be built without
 * runtime secrets, which is backwards.
 */
function handle(request: Request): Promise<Response> {
  return getAuth().handler(request)
}

export const GET = handle
export const POST = handle
