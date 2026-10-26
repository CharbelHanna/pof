import { campaigns } from '@pof/core'
import {
  campaignIdSchema,
  createCampaignSchema,
  listCampaignsSchema,
  updateCampaignSchema,
} from '@pof/schemas'

import { authed } from '../base.ts'

/** Thin adapters over `@pof/core`. See routers/shoot.ts for the pattern. */
export const campaignRouter = {
  create: authed
    .route({ method: 'POST', path: '/campaigns', summary: 'Create a campaign' })
    .input(createCampaignSchema)
    .handler(({ input, context }) => campaigns.createCampaign(context.db, context.tenant, input)),

  list: authed
    .route({ method: 'GET', path: '/campaigns', summary: 'List campaigns' })
    .input(listCampaignsSchema)
    .handler(({ input, context }) => campaigns.listCampaigns(context.db, context.tenant, input)),

  get: authed
    .route({ method: 'GET', path: '/campaigns/{id}', summary: 'Get a campaign' })
    .input(campaignIdSchema)
    .handler(({ input, context }) => campaigns.getCampaign(context.db, context.tenant, input.id)),

  update: authed
    .route({ method: 'PATCH', path: '/campaigns/{id}', summary: 'Update a campaign' })
    .input(updateCampaignSchema)
    .handler(({ input, context }) => campaigns.updateCampaign(context.db, context.tenant, input)),

  delete: authed
    .route({ method: 'DELETE', path: '/campaigns/{id}', summary: 'Delete a campaign' })
    .input(campaignIdSchema)
    .handler(({ input, context }) =>
      campaigns.deleteCampaign(context.db, context.tenant, input.id),
    ),
}
