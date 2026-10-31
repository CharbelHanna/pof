import { sessionLocations } from '@pof/core'
import {
  addSessionLocationSchema,
  listSessionLocationsSchema,
  reorderSessionLocationsSchema,
  sessionLocationIdSchema,
  updateSessionLocationSchema,
} from '@pof/schemas'

import { authed } from '../base.ts'

/** Thin adapters over `@pof/core`. See routers/shoot.ts for the pattern. */
export const sessionLocationRouter = {
  add: authed
    .route({ method: 'POST', path: '/session-locations', summary: 'Add a stop to a session' })
    .input(addSessionLocationSchema)
    .handler(({ input, context }) =>
      sessionLocations.addSessionLocation(context.db, context.tenant, input),
    ),

  list: authed
    .route({ method: 'GET', path: '/session-locations', summary: 'List a session’s stops' })
    .input(listSessionLocationsSchema)
    .handler(({ input, context }) =>
      sessionLocations.listSessionLocations(context.db, context.tenant, input),
    ),

  update: authed
    .route({ method: 'PATCH', path: '/session-locations/{id}', summary: 'Update a stop' })
    .input(updateSessionLocationSchema)
    .handler(({ input, context }) =>
      sessionLocations.updateSessionLocation(context.db, context.tenant, input),
    ),

  remove: authed
    .route({ method: 'DELETE', path: '/session-locations/{id}', summary: 'Remove a stop' })
    .input(sessionLocationIdSchema)
    .handler(({ input, context }) =>
      sessionLocations.removeSessionLocation(context.db, context.tenant, input.id),
    ),

  /**
   * POST rather than PATCH: this rewrites the position of every stop on the
   * session, so it is not a patch of the addressed resource.
   */
  reorder: authed
    .route({ method: 'POST', path: '/session-locations/reorder', summary: 'Set the route order' })
    .input(reorderSessionLocationsSchema)
    .handler(({ input, context }) =>
      sessionLocations.reorderSessionLocations(context.db, context.tenant, input),
    ),
}
