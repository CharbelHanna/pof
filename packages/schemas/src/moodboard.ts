import { z } from 'zod'

/**
 * Moodboard contracts.
 *
 * A board belongs to a shoot and holds references in a deliberate order —
 * what sits next to what is the idea being expressed, so position is part of
 * the contract rather than a display detail.
 */

const name = z.string().trim().min(1, 'Name is required').max(200)
const longText = z.string().max(10_000)

const queryNumber = z.coerce.number()
const queryBoolean = z.union([z.boolean(), z.stringbool()])

/** Sparse by convention (0, 10, 20), bounded well below int4. */
const position = queryNumber.int().min(0).max(1_000_000_000)

export const createMoodboardSchema = z.object({
  id: z.uuid().optional(),
  shootId: z.uuid(),
  name,
  notes: longText.nullable().optional(),
})
export type CreateMoodboardInput = z.infer<typeof createMoodboardSchema>

export const updateMoodboardSchema = z.object({
  id: z.uuid(),
  name: name.optional(),
  notes: longText.nullable().optional(),
})
export type UpdateMoodboardInput = z.infer<typeof updateMoodboardSchema>

export const listMoodboardsSchema = z.object({
  shootId: z.uuid().optional(),
  cursor: z.uuid().optional(),
  limit: queryNumber.int().min(1).max(200).default(100),
  updatedSince: z.coerce.date().optional(),
  includeDeleted: queryBoolean.default(false),
})
export type ListMoodboardsInput = z.infer<typeof listMoodboardsSchema>

export const moodboardIdSchema = z.object({ id: z.uuid() })

// --- items ----------------------------------------------------------------

export const addMoodboardItemSchema = z.object({
  id: z.uuid().optional(),
  moodboardId: z.uuid(),
  assetId: z.uuid(),
  /** Omitted means "append to the end of the board". */
  position: position.optional(),
  /** Why this reference is here: "this light", "this crop", "not the pose". */
  caption: longText.nullable().optional(),
})
export type AddMoodboardItemInput = z.infer<typeof addMoodboardItemSchema>

export const updateMoodboardItemSchema = z.object({
  id: z.uuid(),
  position: position.optional(),
  caption: longText.nullable().optional(),
})
export type UpdateMoodboardItemInput = z.infer<typeof updateMoodboardItemSchema>

export const listMoodboardItemsSchema = z.object({
  moodboardId: z.uuid().optional(),
  cursor: z.uuid().optional(),
  limit: queryNumber.int().min(1).max(500).default(200),
  updatedSince: z.coerce.date().optional(),
  includeDeleted: queryBoolean.default(false),
})
export type ListMoodboardItemsInput = z.infer<typeof listMoodboardItemsSchema>

export const moodboardItemIdSchema = z.object({ id: z.uuid() })

/**
 * Rearranging is one operation, not a series of updates.
 *
 * Dragging one image changes the position of every image it passed. Sent as
 * independent patches the board would be briefly wrong, and permanently so
 * if one request failed — on a surface whose entire purpose is the
 * arrangement.
 */
export const reorderMoodboardSchema = z.object({
  moodboardId: z.uuid(),
  /** Every live item on the board, in its new order. */
  orderedIds: z.array(z.uuid()).min(1).max(500),
})
export type ReorderMoodboardInput = z.infer<typeof reorderMoodboardSchema>
