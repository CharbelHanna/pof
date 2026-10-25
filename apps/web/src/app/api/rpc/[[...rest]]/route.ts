import { RPCHandler } from '@orpc/server/fetch'
import { router } from '@pof/api'

import { getDb } from '~/lib/db.ts'
import { resolveSession } from '~/lib/session.ts'

/**
 * The RPC endpoint — what the typed client talks to.
 *
 * The future Expo app hits this exact handler with the same client and a
 * different base URL. No new server code is required for mobile, which is the
 * point of keeping business logic out of route handlers.
 */
export const runtime = 'nodejs'

const handler = new RPCHandler(router)

async function handle(request: Request): Promise<Response> {
  const { response } = await handler.handle(request, {
    prefix: '/api/rpc',
    context: {
      db: getDb(),
      // Resolved server-side on every request. See lib/session.ts for why the
      // client's active-organization value is never trusted on its own.
      session: await resolveSession(request.headers),
    },
  })

  return response ?? new Response('Not found', { status: 404 })
}

export const GET = handle
export const POST = handle
export const PUT = handle
export const PATCH = handle
export const DELETE = handle
