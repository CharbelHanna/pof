import { sessions } from '@pof/core'
import {
  createSessionSchema,
  listSessionsSchema,
  sessionIdSchema,
  updateSessionSchema,
} from '@pof/schemas'

import { authed } from '../base.ts'

/** Thin adapters over `@pof/core`. See routers/shoot.ts for the pattern. */
export const sessionRouter = {
  create: authed
    .route({ method: 'POST', path: '/sessions', summary: 'Create a session' })
    .input(createSessionSchema)
    .handler(({ input, context }) => sessions.createSession(context.db, context.tenant, input)),

  list: authed
    .route({ method: 'GET', path: '/sessions', summary: 'List sessions' })
    .input(listSessionsSchema)
    .handler(({ input, context }) => sessions.listSessions(context.db, context.tenant, input)),

  get: authed
    .route({ method: 'GET', path: '/sessions/{id}', summary: 'Get a session' })
    .input(sessionIdSchema)
    .handler(({ input, context }) => sessions.getSession(context.db, context.tenant, input.id)),

  update: authed
    .route({ method: 'PATCH', path: '/sessions/{id}', summary: 'Update a session' })
    .input(updateSessionSchema)
    .handler(({ input, context }) => sessions.updateSession(context.db, context.tenant, input)),

  delete: authed
    .route({ method: 'DELETE', path: '/sessions/{id}', summary: 'Delete a session' })
    .input(sessionIdSchema)
    .handler(({ input, context }) => sessions.deleteSession(context.db, context.tenant, input.id)),
}
