import { z } from 'zod'

/**
 * Checklist contracts.
 *
 * A checklist is the readiness half of preparation — what to bring, what to do
 * beforehand, what happens afterwards, how to get in. Distinct from a shot,
 * which is an intention about an image.
 *
 * Lists hang off a shoot with an optional session, the same "either level"
 * shape shots, crew and gear use: a gear list is packed once for the trip, a
 * prep list often belongs to one day.
 */

export const CHECKLIST_KINDS = ['gear', 'prep', 'post', 'travel'] as const
export const checklistKindSchema = z.enum(CHECKLIST_KINDS)
export type ChecklistKind = z.infer<typeof checklistKindSchema>

/** Labels for the UI, so the enum values never have to be shown raw. */
export const CHECKLIST_KIND_LABELS: Record<ChecklistKind, string> = {
  gear: 'Gear',
  prep: 'Prep',
  post: 'Post',
  travel: 'Travel',
}

/**
 * What each kind is for, shown when choosing one. The distinction is only
 * obvious to the person who named them, and a list filed under the wrong kind
 * is a list nobody finds on the morning.
 */
export const CHECKLIST_KIND_DESCRIPTIONS: Record<ChecklistKind, string> = {
  gear: 'What to bring — the one you check in a car park at 05:00.',
  prep: 'What to do beforehand: charge, format, confirm, book, scout.',
  post: 'After the shutter stops: backup, cull, edit, deliver.',
  travel: 'Getting there and back: permits, parking, tickets, access codes.',
}

const name = z.string().trim().min(1, 'Name is required').max(200)
const label = z.string().trim().min(1, 'Label is required').max(500)
const longText = z.string().max(10_000)

const queryNumber = z.coerce.number()
const queryBoolean = z.union([z.boolean(), z.stringbool()])

/**
 * Sparse by convention (10, 20, 30) so an item can be inserted between two
 * others without renumbering the list. Bounded well below int4 so repeated
 * midpoint insertion cannot overflow the column.
 */
const position = z.coerce.number().int().min(0).max(1_000_000_000)

/**
 * "Two of them" — spare batteries, cards, sandbags.
 *
 * Minimum 1 rather than 0: an item you need none of is an item that should not
 * be on the list, and allowing zero invites a row that silently means nothing.
 */
const quantity = z.coerce.number().int().min(1).max(10_000)

export const createChecklistSchema = z.object({
  id: z.uuid().optional(),
  shootId: z.uuid(),
  /** Null means the list belongs to the shoot as a whole. */
  sessionId: z.uuid().nullable().optional(),
  kind: checklistKindSchema.default('prep'),
  name,
  position: position.optional(),
  notes: longText.nullable().optional(),
})
export type CreateChecklistInput = z.infer<typeof createChecklistSchema>

export const updateChecklistSchema = z.object({
  id: z.uuid(),
  sessionId: z.uuid().nullable().optional(),
  kind: checklistKindSchema.optional(),
  name: name.optional(),
  position: position.optional(),
  notes: longText.nullable().optional(),
})
export type UpdateChecklistInput = z.infer<typeof updateChecklistSchema>

export const listChecklistsSchema = z.object({
  shootId: z.uuid().optional(),
  /**
   * Filter to one session. `sessionId: null` is NOT the same as omitting this:
   * null asks for the lists belonging to the whole shoot rather than to any
   * particular session.
   */
  sessionId: z.uuid().nullable().optional(),
  kind: checklistKindSchema.optional(),
  cursor: z.uuid().optional(),
  limit: queryNumber.int().min(1).max(200).default(100),
  updatedSince: z.coerce.date().optional(),
  includeDeleted: queryBoolean.default(false),
})
export type ListChecklistsInput = z.infer<typeof listChecklistsSchema>

export const checklistIdSchema = z.object({ id: z.uuid() })

// --- items ----------------------------------------------------------------

export const createChecklistItemSchema = z.object({
  id: z.uuid().optional(),
  checklistId: z.uuid(),
  label,
  quantity: quantity.optional(),
  position: position.optional(),
  notes: longText.nullable().optional(),
})
export type CreateChecklistItemInput = z.infer<typeof createChecklistItemSchema>

export const updateChecklistItemSchema = z.object({
  id: z.uuid(),
  label: label.optional(),
  quantity: quantity.optional(),
  position: position.optional(),
  notes: longText.nullable().optional(),
})
export type UpdateChecklistItemInput = z.infer<typeof updateChecklistItemSchema>

/**
 * Ticking is its own operation, not an `update` with a timestamp.
 *
 * The caller says *whether* it is done; the server decides *when*, from its
 * own clock. A client-supplied `doneAt` would let a phone with a wrong clock
 * record that the batteries were packed tomorrow, and "packed at 04:52" is
 * only worth storing if it is true.
 */
export const setChecklistItemDoneSchema = z.object({
  id: z.uuid(),
  done: z.boolean(),
})
export type SetChecklistItemDoneInput = z.infer<typeof setChecklistItemDoneSchema>

export const listChecklistItemsSchema = z.object({
  checklistId: z.uuid().optional(),
  cursor: z.uuid().optional(),
  limit: queryNumber.int().min(1).max(500).default(200),
  updatedSince: z.coerce.date().optional(),
  includeDeleted: queryBoolean.default(false),
})
export type ListChecklistItemsInput = z.infer<typeof listChecklistItemsSchema>

export const checklistItemIdSchema = z.object({ id: z.uuid() })

/**
 * Reordering is its own operation rather than a series of updates.
 *
 * Dragging one item up a list changes the position of every item it passed,
 * and sending those as independent patches would leave the list briefly
 * inconsistent — and permanently so if one request failed. The server rewrites
 * the whole order in a single transaction instead.
 */
export const reorderChecklistItemsSchema = z.object({
  checklistId: z.uuid(),
  /** Item ids in their new order. */
  orderedIds: z.array(z.uuid()).min(1).max(500),
})
export type ReorderChecklistItemsInput = z.infer<typeof reorderChecklistItemsSchema>

/**
 * Add several items at once.
 *
 * Checklists are written in bursts — someone types out a packing list from
 * memory in one sitting — and one request per line would make that feel like
 * filling in a form forty times.
 */
export const addChecklistItemsSchema = z.object({
  checklistId: z.uuid(),
  labels: z.array(label).min(1).max(100),
})
export type AddChecklistItemsInput = z.infer<typeof addChecklistItemsSchema>
