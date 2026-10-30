import { shotGear } from '@pof/core'
import {
  addShotGearRequirementSchema,
  listShotGearRequirementsSchema,
  shotGearRequirementIdSchema,
  updateShotGearRequirementSchema,
} from '@pof/schemas'

import { authed } from '../base.ts'

/** Thin adapters over `@pof/core`. See routers/shoot.ts for the pattern. */
export const shotGearRouter = {
  add: authed
    .route({ method: 'POST', path: '/shot-gear', summary: 'Require a gear item for a shot' })
    .input(addShotGearRequirementSchema)
    .handler(({ input, context }) =>
      shotGear.addShotGearRequirement(context.db, context.tenant, input),
    ),

  list: authed
    .route({ method: 'GET', path: '/shot-gear', summary: 'List gear required by a shot' })
    .input(listShotGearRequirementsSchema)
    .handler(({ input, context }) =>
      shotGear.listShotGearRequirements(context.db, context.tenant, input),
    ),

  update: authed
    .route({ method: 'PATCH', path: '/shot-gear/{id}', summary: 'Update a gear requirement' })
    .input(updateShotGearRequirementSchema)
    .handler(({ input, context }) =>
      shotGear.updateShotGearRequirement(context.db, context.tenant, input),
    ),

  remove: authed
    .route({ method: 'DELETE', path: '/shot-gear/{id}', summary: 'Remove a gear requirement' })
    .input(shotGearRequirementIdSchema)
    .handler(({ input, context }) =>
      shotGear.removeShotGearRequirement(context.db, context.tenant, input.id),
    ),
}
