import { gear } from '@pof/core'
import {
  addShootGearSchema,
  createGearItemSchema,
  gearItemIdSchema,
  listGearItemsSchema,
  listShootGearSchema,
  shootGearIdSchema,
  updateGearItemSchema,
  updateShootGearSchema,
} from '@pof/schemas'

import { authed } from '../base.ts'

/** The workspace's library of owned kit. */
export const gearItemRouter = {
  create: authed
    .route({ method: 'POST', path: '/gear-items', summary: 'Add kit to the library' })
    .input(createGearItemSchema)
    .handler(({ input, context }) => gear.createGearItem(context.db, context.tenant, input)),

  list: authed
    .route({ method: 'GET', path: '/gear-items', summary: 'List the gear library' })
    .input(listGearItemsSchema)
    .handler(({ input, context }) => gear.listGearItems(context.db, context.tenant, input)),

  update: authed
    .route({ method: 'PATCH', path: '/gear-items/{id}', summary: 'Update a gear item' })
    .input(updateGearItemSchema)
    .handler(({ input, context }) => gear.updateGearItem(context.db, context.tenant, input)),

  delete: authed
    .route({ method: 'DELETE', path: '/gear-items/{id}', summary: 'Retire a gear item' })
    .input(gearItemIdSchema)
    .handler(({ input, context }) => gear.deleteGearItem(context.db, context.tenant, input.id)),
}

/** Kit selected for a particular shoot. */
export const shootGearRouter = {
  add: authed
    .route({ method: 'POST', path: '/shoot-gear', summary: 'Add gear to a shoot' })
    .input(addShootGearSchema)
    .handler(({ input, context }) => gear.addShootGear(context.db, context.tenant, input)),

  list: authed
    .route({ method: 'GET', path: '/shoot-gear', summary: "List a shoot's gear" })
    .input(listShootGearSchema)
    .handler(({ input, context }) => gear.listShootGear(context.db, context.tenant, input)),

  update: authed
    .route({ method: 'PATCH', path: '/shoot-gear/{id}', summary: 'Update gear on a shoot' })
    .input(updateShootGearSchema)
    .handler(({ input, context }) => gear.updateShootGear(context.db, context.tenant, input)),

  remove: authed
    .route({ method: 'DELETE', path: '/shoot-gear/{id}', summary: 'Remove gear from a shoot' })
    .input(shootGearIdSchema)
    .handler(({ input, context }) => gear.removeShootGear(context.db, context.tenant, input.id)),
}
