import { shotReferences } from '@pof/core'
import {
  addShotReferenceSchema,
  listShotReferencesSchema,
  shotReferenceIdSchema,
  updateShotReferenceSchema,
} from '@pof/schemas'

import { authed } from '../base.ts'

/** Thin adapters over `@pof/core`. See routers/shoot.ts for the pattern. */
export const shotReferenceRouter = {
  add: authed
    .route({ method: 'POST', path: '/shot-references', summary: 'Attach a reference to a shot' })
    .input(addShotReferenceSchema)
    .handler(({ input, context }) =>
      shotReferences.addShotReference(context.db, context.tenant, input),
    ),

  list: authed
    .route({ method: 'GET', path: '/shot-references', summary: 'List a shot’s references' })
    .input(listShotReferencesSchema)
    .handler(({ input, context }) =>
      shotReferences.listShotReferences(context.db, context.tenant, input),
    ),

  update: authed
    .route({ method: 'PATCH', path: '/shot-references/{id}', summary: 'Annotate a reference' })
    .input(updateShotReferenceSchema)
    .handler(({ input, context }) =>
      shotReferences.updateShotReference(context.db, context.tenant, input),
    ),

  remove: authed
    .route({ method: 'DELETE', path: '/shot-references/{id}', summary: 'Detach a reference' })
    .input(shotReferenceIdSchema)
    .handler(({ input, context }) =>
      shotReferences.removeShotReference(context.db, context.tenant, input.id),
    ),
}
