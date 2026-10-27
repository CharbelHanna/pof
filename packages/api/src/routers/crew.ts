import { crew } from '@pof/core'
import {
  createCrewMemberSchema,
  crewMemberIdSchema,
  listCrewSchema,
  updateCrewMemberSchema,
} from '@pof/schemas'

import { authed } from '../base.ts'

/** Thin adapters over `@pof/core`. See routers/shoot.ts for the pattern. */
export const crewRouter = {
  create: authed
    .route({ method: 'POST', path: '/crew', summary: 'Add a crew member to a shoot' })
    .input(createCrewMemberSchema)
    .handler(({ input, context }) => crew.createCrewMember(context.db, context.tenant, input)),

  list: authed
    .route({ method: 'GET', path: '/crew', summary: 'List crew' })
    .input(listCrewSchema)
    .handler(({ input, context }) => crew.listCrew(context.db, context.tenant, input)),

  update: authed
    .route({ method: 'PATCH', path: '/crew/{id}', summary: 'Update a crew member' })
    .input(updateCrewMemberSchema)
    .handler(({ input, context }) => crew.updateCrewMember(context.db, context.tenant, input)),

  delete: authed
    .route({ method: 'DELETE', path: '/crew/{id}', summary: 'Remove a crew member' })
    .input(crewMemberIdSchema)
    .handler(({ input, context }) => crew.deleteCrewMember(context.db, context.tenant, input.id)),
}
