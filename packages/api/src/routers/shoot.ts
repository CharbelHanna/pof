import { shoots } from '@pof/core'
import { createShootSchema, listShootsSchema, shootIdSchema, updateShootSchema } from '@pof/schemas'

import { authed } from '../base.ts'

/**
 * Shoot procedures.
 *
 * Each is a thin adapter over `@pof/core`. The `.route()` annotations give the
 * generated OpenAPI spec sensible REST paths, so the same procedures serve a
 * fully-typed RPC client (web today, Expo later) *and* a documented HTTP API
 * for third parties — without a hand-written parallel layer.
 */
export const shootRouter = {
  create: authed
    .route({ method: 'POST', path: '/shoots', summary: 'Create a shoot' })
    .input(createShootSchema)
    .handler(({ input, context }) => shoots.createShoot(context.db, context.tenant, input)),

  list: authed
    .route({ method: 'GET', path: '/shoots', summary: 'List shoots' })
    .input(listShootsSchema)
    .handler(({ input, context }) => shoots.listShoots(context.db, context.tenant, input)),

  get: authed
    .route({ method: 'GET', path: '/shoots/{id}', summary: 'Get a shoot' })
    .input(shootIdSchema)
    .handler(({ input, context }) => shoots.getShoot(context.db, context.tenant, input.id)),

  update: authed
    .route({ method: 'PATCH', path: '/shoots/{id}', summary: 'Update a shoot' })
    .input(updateShootSchema)
    .handler(({ input, context }) => shoots.updateShoot(context.db, context.tenant, input)),

  delete: authed
    .route({ method: 'DELETE', path: '/shoots/{id}', summary: 'Delete a shoot' })
    .input(shootIdSchema)
    .handler(({ input, context }) => shoots.deleteShoot(context.db, context.tenant, input.id)),
}
