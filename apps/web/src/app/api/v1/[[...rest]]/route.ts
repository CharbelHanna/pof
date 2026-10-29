import { OpenAPIHandler } from '@orpc/openapi/fetch'
import { router } from '@pof/api'

import { getDb } from '~/lib/db.ts'
import { getGeocoding } from '~/lib/geocoding.ts'
import { resolveSession } from '~/lib/session.ts'

/**
 * The same procedures, served as RESTful HTTP with a generated OpenAPI spec.
 *
 * This is the reason for choosing oRPC over tRPC: one set of procedures gives
 * both a fully-typed client and a documented HTTP API, with no hand-written
 * parallel layer to keep in step.
 *
 * Not yet a *public* API — it currently authenticates with the same session
 * cookie as the web app. Opening it to third parties means adding an API-key
 * middleware in @pof/api; the surface itself already exists.
 */
export const runtime = 'nodejs'

const handler = new OpenAPIHandler(router)

async function handle(request: Request): Promise<Response> {
  const { response } = await handler.handle(request, {
    prefix: '/api/v1',
    context: {
      db: getDb(),
      geocoding: getGeocoding(),
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
