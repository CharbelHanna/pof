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
  notes: z.string().max(10_000).optional(),
})
export type CreateShootInput = z.infer<typeof createShootSchema>

export const updateShootSchema = z.object({
  id: z.uuid(),
  name: shootName.optional(),
  shootTypeKey: shootTypeKeySchema.optional(),
  status: shootStatusSchema.optional(),
  notes: z.string().max(10_000).nullable().optional(),
})
export type UpdateShootInput = z.infer<typeof updateShootSchema>

export const listShootsSchema = z.object({
  /**
   * Keyset pagination, never OFFSET. Deep OFFSET degrades badly once a
   * workspace has real history, and a cursor is also what incremental sync
   * needs later.
   */
  cursor: z.uuid().optional(),
  limit: z.number().int().min(1).max(100).default(50),
  /**
   * Incremental sync hook, present from day one so the Phase 8 mobile client
   * needs no API change: return only rows touched since this instant,
   * including soft-deleted ones as tombstones.
   */
  updatedSince: z.coerce.date().optional(),
  includeDeleted: z.boolean().default(false),
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
