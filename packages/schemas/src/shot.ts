import { z } from 'zod'

/**
 * Shot contracts.
 *
 * A shot is an individual frame the photographer intends to come away with.
 * It belongs to a shoot, optionally narrowed to a single session — the same
 * "either level" shape crew and gear use, because shot ideas arrive long
 * before anyone schedules the day they will be taken.
 */

export const SHOT_STATUSES = ['planned', 'captured', 'skipped'] as const
export const shotStatusSchema = z.enum(SHOT_STATUSES)
export type ShotStatus = z.infer<typeof shotStatusSchema>

/**
 * Offered in the UI as suggestions, not enforced — the same reasoning as
 * crew roles. Framing vocabulary is genre-specific ("flat lay" means nothing
 * to a landscape photographer) and nothing branches on the value.
 */
export const SHOT_FRAMING_SUGGESTIONS = [
  'Wide',
  'Medium',
  'Close-up',
  'Extreme close-up',
  'Over the shoulder',
  'Low angle',
  'High angle',
  'Flat lay',
  'Detail',
] as const

const title = z.string().trim().min(1, 'Title is required').max(200)
const shortText = z.string().trim().max(200)
const longText = z.string().max(10_000)

const queryNumber = z.coerce.number()
const queryBoolean = z.union([z.boolean(), z.stringbool()])

/**
 * Sparse by convention (10, 20, 30) so a shot can be inserted between two
 * others without renumbering the list. Bounded well below int4 so that
 * repeated midpoint insertion cannot overflow the column.
 */
const position = z.coerce.number().int().min(0).max(1_000_000_000)

export const createShotSchema = z.object({
  id: z.uuid().optional(),
  shootId: z.uuid(),
  /** Null means the shot belongs to the shoot as a whole. */
  sessionId: z.uuid().nullable().optional(),
  title,
  description: longText.nullable().optional(),
  framing: shortText.nullable().optional(),
  subjects: shortText.nullable().optional(),
  props: shortText.nullable().optional(),
  status: shotStatusSchema.default('planned'),
  position: position.optional(),
  notes: longText.nullable().optional(),
})
export type CreateShotInput = z.infer<typeof createShotSchema>

export const updateShotSchema = z.object({
  id: z.uuid(),
  sessionId: z.uuid().nullable().optional(),
  title: title.optional(),
  description: longText.nullable().optional(),
  framing: shortText.nullable().optional(),
  subjects: shortText.nullable().optional(),
  props: shortText.nullable().optional(),
  status: shotStatusSchema.optional(),
  position: position.optional(),
  notes: longText.nullable().optional(),
})
export type UpdateShotInput = z.infer<typeof updateShotSchema>

export const listShotsSchema = z.object({
  shootId: z.uuid().optional(),
  /**
   * Filter to one session. `sessionId: null` is NOT the same as omitting
   * this: null asks for the shots that belong to the whole shoot rather than
   * to any particular session.
   */
  sessionId: z.uuid().nullable().optional(),
  status: shotStatusSchema.optional(),
  cursor: z.uuid().optional(),
  limit: queryNumber.int().min(1).max(200).default(100),
  updatedSince: z.coerce.date().optional(),
  includeDeleted: queryBoolean.default(false),
})
export type ListShotsInput = z.infer<typeof listShotsSchema>

export const shotIdSchema = z.object({ id: z.uuid() })

/**
 * Reordering is its own operation rather than a series of updates.
 *
 * Dragging one shot up a list changes the position of every shot it passed,
 * and sending those as independent patches would leave the list briefly
 * inconsistent — and permanently so if one request failed. The server
 * rewrites the whole running order in a single transaction instead.
 */
export const reorderShotsSchema = z.object({
  shootId: z.uuid(),
  /** Shot ids in their new running order. */
  orderedIds: z.array(z.uuid()).min(1).max(500),
})
export type ReorderShotsInput = z.infer<typeof reorderShotsSchema>
