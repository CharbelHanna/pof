import { moodboards } from '@pof/core'
import {
  addMoodboardItemSchema,
  createMoodboardSchema,
  listMoodboardItemsSchema,
  listMoodboardsSchema,
  moodboardIdSchema,
  moodboardItemIdSchema,
  reorderMoodboardSchema,
  updateMoodboardItemSchema,
  updateMoodboardSchema,
} from '@pof/schemas'

import { authed } from '../base.ts'

/** Thin adapters over `@pof/core`. See routers/shoot.ts for the pattern. */
export const moodboardRouter = {
  create: authed
    .route({ method: 'POST', path: '/moodboards', summary: 'Create a moodboard' })
    .input(createMoodboardSchema)
    .handler(({ input, context }) => moodboards.createMoodboard(context.db, context.tenant, input)),

  list: authed
    .route({ method: 'GET', path: '/moodboards', summary: 'List moodboards' })
    .input(listMoodboardsSchema)
    .handler(({ input, context }) => moodboards.listMoodboards(context.db, context.tenant, input)),

  update: authed
    .route({ method: 'PATCH', path: '/moodboards/{id}', summary: 'Rename a moodboard' })
    .input(updateMoodboardSchema)
    .handler(({ input, context }) => moodboards.updateMoodboard(context.db, context.tenant, input)),

  delete: authed
    .route({ method: 'DELETE', path: '/moodboards/{id}', summary: 'Delete a moodboard' })
    .input(moodboardIdSchema)
    .handler(({ input, context }) =>
      moodboards.deleteMoodboard(context.db, context.tenant, input.id),
    ),

  addItem: authed
    .route({ method: 'POST', path: '/moodboard-items', summary: 'Put an asset on a board' })
    .input(addMoodboardItemSchema)
    .handler(({ input, context }) =>
      moodboards.addMoodboardItem(context.db, context.tenant, input),
    ),

  listItems: authed
    .route({ method: 'GET', path: '/moodboard-items', summary: 'List board items' })
    .input(listMoodboardItemsSchema)
    .handler(({ input, context }) =>
      moodboards.listMoodboardItems(context.db, context.tenant, input),
    ),

  updateItem: authed
    .route({ method: 'PATCH', path: '/moodboard-items/{id}', summary: 'Caption an item' })
    .input(updateMoodboardItemSchema)
    .handler(({ input, context }) =>
      moodboards.updateMoodboardItem(context.db, context.tenant, input),
    ),

  removeItem: authed
    .route({ method: 'DELETE', path: '/moodboard-items/{id}', summary: 'Remove an item' })
    .input(moodboardItemIdSchema)
    .handler(({ input, context }) =>
      moodboards.removeMoodboardItem(context.db, context.tenant, input.id),
    ),

  /** POST, not PATCH: this rewrites the position of every item on the board. */
  reorder: authed
    .route({ method: 'POST', path: '/moodboard-items/reorder', summary: 'Rearrange a board' })
    .input(reorderMoodboardSchema)
    .handler(({ input, context }) =>
      moodboards.reorderMoodboard(context.db, context.tenant, input),
    ),
}
