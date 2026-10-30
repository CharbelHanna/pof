import { shots } from '@pof/core'
import {
  createShotSchema,
  listShotsSchema,
  reorderShotsSchema,
  shotIdSchema,
  updateShotSchema,
} from '@pof/schemas'

import { authed } from '../base.ts'

/** Thin adapters over `@pof/core`. See routers/shoot.ts for the pattern. */
export const shotRouter = {
  create: authed
    .route({ method: 'POST', path: '/shots', summary: 'Add a shot to a shoot' })
    .input(createShotSchema)
    .handler(({ input, context }) => shots.createShot(context.db, context.tenant, input)),

  list: authed
    .route({ method: 'GET', path: '/shots', summary: 'List shots' })
    .input(listShotsSchema)
    .handler(({ input, context }) => shots.listShots(context.db, context.tenant, input)),

  update: authed
    .route({ method: 'PATCH', path: '/shots/{id}', summary: 'Update a shot' })
    .input(updateShotSchema)
    .handler(({ input, context }) => shots.updateShot(context.db, context.tenant, input)),

  delete: authed
    .route({ method: 'DELETE', path: '/shots/{id}', summary: 'Remove a shot' })
    .input(shotIdSchema)
    .handler(({ input, context }) => shots.deleteShot(context.db, context.tenant, input.id)),

  /**
   * POST rather than PATCH: this rewrites the position of every shot on the
   * shoot, so it is not a patch of the addressed resource.
   */
  reorder: authed
    .route({ method: 'POST', path: '/shots/reorder', summary: 'Set the running order' })
    .input(reorderShotsSchema)
    .handler(({ input, context }) => shots.reorderShots(context.db, context.tenant, input)),
}
