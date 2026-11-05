import { checklists } from '@pof/core'
import {
  addChecklistItemsSchema,
  checklistIdSchema,
  checklistItemIdSchema,
  createChecklistItemSchema,
  createChecklistSchema,
  listChecklistItemsSchema,
  listChecklistsSchema,
  reorderChecklistItemsSchema,
  setChecklistItemDoneSchema,
  updateChecklistItemSchema,
  updateChecklistSchema,
} from '@pof/schemas'

import { authed } from '../base.ts'

/** Thin adapters over `@pof/core`. See routers/shoot.ts for the pattern. */
export const checklistRouter = {
  create: authed
    .route({ method: 'POST', path: '/checklists', summary: 'Add a checklist to a shoot' })
    .input(createChecklistSchema)
    .handler(({ input, context }) => checklists.createChecklist(context.db, context.tenant, input)),

  list: authed
    .route({ method: 'GET', path: '/checklists', summary: 'List checklists with progress' })
    .input(listChecklistsSchema)
    .handler(({ input, context }) => checklists.listChecklists(context.db, context.tenant, input)),

  update: authed
    .route({ method: 'PATCH', path: '/checklists/{id}', summary: 'Update a checklist' })
    .input(updateChecklistSchema)
    .handler(({ input, context }) => checklists.updateChecklist(context.db, context.tenant, input)),

  delete: authed
    .route({
      method: 'DELETE',
      path: '/checklists/{id}',
      summary: 'Remove a checklist and its items',
    })
    .input(checklistIdSchema)
    .handler(({ input, context }) =>
      checklists.deleteChecklist(context.db, context.tenant, input.id),
    ),
}

export const checklistItemRouter = {
  create: authed
    .route({ method: 'POST', path: '/checklist-items', summary: 'Add one item' })
    .input(createChecklistItemSchema)
    .handler(({ input, context }) =>
      checklists.createChecklistItem(context.db, context.tenant, input),
    ),

  /**
   * Separate from `create` because the shape differs, not merely the count:
   * this takes bare labels and positions them, which is how a packing list
   * actually gets typed — in one burst, from memory.
   */
  addMany: authed
    .route({ method: 'POST', path: '/checklist-items/bulk', summary: 'Add several items at once' })
    .input(addChecklistItemsSchema)
    .handler(({ input, context }) =>
      checklists.addChecklistItems(context.db, context.tenant, input),
    ),

  list: authed
    .route({ method: 'GET', path: '/checklist-items', summary: 'List checklist items' })
    .input(listChecklistItemsSchema)
    .handler(({ input, context }) =>
      checklists.listChecklistItems(context.db, context.tenant, input),
    ),

  update: authed
    .route({ method: 'PATCH', path: '/checklist-items/{id}', summary: 'Update an item' })
    .input(updateChecklistItemSchema)
    .handler(({ input, context }) =>
      checklists.updateChecklistItem(context.db, context.tenant, input),
    ),

  /**
   * Its own route rather than a field on `update`, because the server sets
   * the timestamp. The caller says whether; it never says when.
   */
  setDone: authed
    .route({ method: 'POST', path: '/checklist-items/{id}/done', summary: 'Tick or untick' })
    .input(setChecklistItemDoneSchema)
    .handler(({ input, context }) =>
      checklists.setChecklistItemDone(context.db, context.tenant, input),
    ),

  delete: authed
    .route({ method: 'DELETE', path: '/checklist-items/{id}', summary: 'Remove an item' })
    .input(checklistItemIdSchema)
    .handler(({ input, context }) =>
      checklists.deleteChecklistItem(context.db, context.tenant, input.id),
    ),

  /**
   * POST rather than PATCH: this rewrites the position of every item on the
   * list, so it is not a patch of the addressed resource.
   */
  reorder: authed
    .route({ method: 'POST', path: '/checklist-items/reorder', summary: 'Set the order' })
    .input(reorderChecklistItemsSchema)
    .handler(({ input, context }) =>
      checklists.reorderChecklistItems(context.db, context.tenant, input),
    ),
}
