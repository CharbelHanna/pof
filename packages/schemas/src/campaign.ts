import { z } from 'zod'

/**
 * Campaign contracts.
 *
 * A campaign is an optional grouping of shoots. Nothing requires one, so
 * every field beyond the name is optional.
 */

export const CAMPAIGN_STATUSES = ['draft', 'active', 'completed', 'cancelled'] as const
export const campaignStatusSchema = z.enum(CAMPAIGN_STATUSES)
export type CampaignStatus = z.infer<typeof campaignStatusSchema>

const campaignName = z.string().trim().min(1, 'Name is required').max(200)
const plainDate = z.string().date()

/**
 * Both transports, one schema: the RPC surface sends JSON with real types,
 * the OpenAPI surface sends query strings. See the note in shoot.ts.
 */
const queryNumber = z.coerce.number()
const queryBoolean = z.union([z.boolean(), z.stringbool()])

/**
 * A campaign that ends before it starts is always a mistake. Checked here as
 * well as in the database so the user gets a field-level message rather than
 * a constraint violation.
 */
const orderedDates = <T extends { startsOn?: string | null; endsOn?: string | null }>(
  value: T,
  ctx: z.RefinementCtx,
) => {
  if (value.startsOn && value.endsOn && value.endsOn < value.startsOn) {
    ctx.addIssue({
      code: 'custom',
      path: ['endsOn'],
      message: 'The end date cannot be before the start date',
    })
  }
}

export const createCampaignSchema = z
  .object({
    id: z.uuid().optional(),
    name: campaignName,
    brief: z.string().max(10_000).optional(),
    status: campaignStatusSchema.default('draft'),
    startsOn: plainDate.nullable().optional(),
    endsOn: plainDate.nullable().optional(),
  })
  .superRefine(orderedDates)
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>

export const updateCampaignSchema = z
  .object({
    id: z.uuid(),
    name: campaignName.optional(),
    brief: z.string().max(10_000).nullable().optional(),
    status: campaignStatusSchema.optional(),
    startsOn: plainDate.nullable().optional(),
    endsOn: plainDate.nullable().optional(),
  })
  .superRefine(orderedDates)
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>

export const listCampaignsSchema = z.object({
  cursor: z.uuid().optional(),
  limit: queryNumber.int().min(1).max(100).default(50),
  updatedSince: z.coerce.date().optional(),
  includeDeleted: queryBoolean.default(false),
})
export type ListCampaignsInput = z.infer<typeof listCampaignsSchema>

export const campaignIdSchema = z.object({ id: z.uuid() })
