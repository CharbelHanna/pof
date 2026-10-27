import { z } from 'zod'

/**
 * Gear contracts.
 *
 * Two levels: the workspace's LIBRARY of owned kit, and the SELECTION of that
 * kit for a particular shoot. Keeping them separate is what makes "my 85mm"
 * one thing rather than a string retyped per shoot.
 */

/** Suggestions only. Photographers group kit in ways no fixed list predicts. */
export const GEAR_CATEGORY_SUGGESTIONS = [
  'Camera',
  'Lens',
  'Lighting',
  'Modifier',
  'Support',
  'Power',
  'Storage',
  'Audio',
  'Grip',
  'Other',
] as const

const gearName = z.string().trim().min(1, 'Name is required').max(200)
const category = z.string().trim().max(80)

const queryNumber = z.coerce.number()
const queryBoolean = z.union([z.boolean(), z.stringbool()])

// --- library -------------------------------------------------------------

export const createGearItemSchema = z.object({
  id: z.uuid().optional(),
  name: gearName,
  category: category.nullable().optional(),
  notes: z.string().max(10_000).nullable().optional(),
})
export type CreateGearItemInput = z.infer<typeof createGearItemSchema>

export const updateGearItemSchema = z.object({
  id: z.uuid(),
  name: gearName.optional(),
  category: category.nullable().optional(),
  notes: z.string().max(10_000).nullable().optional(),
})
export type UpdateGearItemInput = z.infer<typeof updateGearItemSchema>

export const listGearItemsSchema = z.object({
  cursor: z.uuid().optional(),
  limit: queryNumber.int().min(1).max(200).default(100),
  updatedSince: z.coerce.date().optional(),
  includeDeleted: queryBoolean.default(false),
})
export type ListGearItemsInput = z.infer<typeof listGearItemsSchema>

export const gearItemIdSchema = z.object({ id: z.uuid() })

// --- selection for a shoot ------------------------------------------------

export const addShootGearSchema = z.object({
  id: z.uuid().optional(),
  shootId: z.uuid(),
  gearItemId: z.uuid(),
  /** "Two of them" is a quantity, not two rows. */
  quantity: queryNumber.int().min(1).max(999).default(1),
})
export type AddShootGearInput = z.infer<typeof addShootGearSchema>

export const updateShootGearSchema = z.object({
  id: z.uuid(),
  quantity: queryNumber.int().min(1).max(999).optional(),
  /** Ticked while packing — the point of the list on the day. */
  packed: queryBoolean.optional(),
})
export type UpdateShootGearInput = z.infer<typeof updateShootGearSchema>

export const listShootGearSchema = z.object({
  shootId: z.uuid().optional(),
  cursor: z.uuid().optional(),
  limit: queryNumber.int().min(1).max(200).default(100),
  updatedSince: z.coerce.date().optional(),
  includeDeleted: queryBoolean.default(false),
})
export type ListShootGearInput = z.infer<typeof listShootGearSchema>

export const shootGearIdSchema = z.object({ id: z.uuid() })
