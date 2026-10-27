import { z } from 'zod'

/**
 * Shoot contracts.
 *
 * One Zod schema per operation drives three things at once: the oRPC procedure
 * contract (and therefore the generated OpenAPI spec), the React Hook Form
 * resolver, and the inferred TypeScript type. There is no second place where
 * the shape of a shoot is written down.
 */

export const SHOOT_STATUSES = [
  'draft',
  'planning',
  'confirmed',
  'shooting',
  'completed',
  'cancelled',
] as const

export const shootStatusSchema = z.enum(SHOOT_STATUSES)
export type ShootStatus = z.infer<typeof shootStatusSchema>

/**
 * Phase 0 keeps the genre list inline. Phase 1 replaces this with the
 * shoot-type registry — a seeded reference table plus a discriminated-union
 * schema per genre — so that adding "wedding" or "architecture" is an INSERT
 * rather than a migration and a deploy. The column is already a free-text key
 * rather than a PG enum precisely so that swap needs no schema change.
 */
export const shootTypeKeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9-]+$/, 'shoot type key must be lowercase kebab-case')

const shootName = z.string().trim().min(1, 'Name is required').max(200)

/**
 * A calendar date with no time of day — a delivery deadline or an issue date.
 * Kept as a string rather than a Date so it cannot drift across timezones:
 * "due on the 3rd" must not become the 2nd for a viewer further west.
 */
const plainDate = z.string().date()

/**
 * Genre-specific fields. Validated against the shoot-type registry in the
 * service layer, where the genre key is known — a schema here cannot do it,
 * because the right shape depends on a sibling field's value.
 */
const detailsInput = z.record(z.string(), z.unknown()).optional()

export const createShootSchema = z.object({
  /**
   * Supplied by the client, not the server — see `newId()`. Optional so a
   * simple web form need not care, required in practice for offline clients
   * that must be able to replay a create idempotently.
   */
  id: z.uuid().optional(),
  name: shootName,
  shootTypeKey: shootTypeKeySchema.default('portrait'),
  status: shootStatusSchema.default('draft'),
  campaignId: z.uuid().nullable().optional(),
  deliveryDate: plainDate.nullable().optional(),
  details: detailsInput,
  notes: z.string().max(10_000).optional(),
})
export type CreateShootInput = z.infer<typeof createShootSchema>

export const updateShootSchema = z.object({
  id: z.uuid(),
  name: shootName.optional(),
  shootTypeKey: shootTypeKeySchema.optional(),
  status: shootStatusSchema.optional(),
  campaignId: z.uuid().nullable().optional(),
  deliveryDate: plainDate.nullable().optional(),
  details: detailsInput,
  notes: z.string().max(10_000).nullable().optional(),
})
export type UpdateShootInput = z.infer<typeof updateShootSchema>

/**
 * Inputs must survive BOTH transports.
 *
 * The RPC surface sends a JSON body, so `limit` arrives as a real number and
 * `includeDeleted` as a real boolean. The OpenAPI/REST surface serves the same
 * procedure over `GET /shoots?limit=50`, where every value is a string. A
 * plain `z.number()` therefore rejects every REST call — and only the REST
 * call, which is exactly the kind of asymmetry that goes unnoticed until a
 * third party integrates.
 *
 * `z.coerce.number()` accepts both. Booleans need more care: `z.coerce
 * .boolean()` follows JavaScript truthiness, so the string "false" would
 * become `true`. `z.stringbool()` parses the string correctly but rejects a
 * real boolean, so the two are unioned.
 */
const queryNumber = z.coerce.number()
const queryBoolean = z.union([z.boolean(), z.stringbool()])

/**
 * Filter the list by campaign.
 *
 * Three states, not two: a specific campaign, explicitly ungrouped shoots, or
 * no filter at all. `'none'` is a deliberate sentinel rather than `null` —
 * over the REST surface every query value is a string, so `?campaignId=` and
 * an absent parameter are indistinguishable, and "shoots in no campaign" is a
 * question people genuinely ask.
 */
export const campaignFilterSchema = z.union([z.uuid(), z.literal('none')])

export const listShootsSchema = z.object({
  campaignId: campaignFilterSchema.optional(),
  /**
   * Keyset pagination, never OFFSET. Deep OFFSET degrades badly once a
   * workspace has real history, and a cursor is also what incremental sync
   * needs later.
   */
  cursor: z.uuid().optional(),
  limit: queryNumber.int().min(1).max(100).default(50),
  /**
   * Incremental sync hook, present from day one so the Phase 8 mobile client
   * needs no API change: return only rows touched since this instant,
   * including soft-deleted ones as tombstones.
   */
  updatedSince: z.coerce.date().optional(),
  includeDeleted: queryBoolean.default(false),
})
export type ListShootsInput = z.infer<typeof listShootsSchema>

export const shootIdSchema = z.object({ id: z.uuid() })

export const shootSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  name: z.string(),
  shootTypeKey: z.string(),
  status: shootStatusSchema,
  notes: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  deletedAt: z.date().nullable(),
})
export type Shoot = z.infer<typeof shootSchema>
