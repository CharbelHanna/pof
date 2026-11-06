import { z } from 'zod'

import { checklistKindSchema } from './checklist.ts'

/**
 * Session template contracts.
 *
 * A template is a reusable prep blueprint: the shot list and the checklists a
 * recurring kind of shoot always needs. Applying one copies its contents into
 * a session as real rows.
 *
 * Versions are immutable. Editing a template publishes a new version rather
 * than changing the one already applied to past sessions — see the schema
 * file for why that matters more than it looks.
 */

const name = z.string().trim().min(1, 'Name is required').max(200)
const shortText = z.string().trim().max(200)
const longText = z.string().max(10_000)
const label = z.string().trim().min(1, 'Label is required').max(500)

const queryNumber = z.coerce.number()
const queryBoolean = z.union([z.boolean(), z.stringbool()])

/**
 * One line of a template.
 *
 * A discriminated union rather than a bag of optional fields, so that adding
 * a kind later — a timeline block, a note — is an added member rather than
 * another nullable column every existing branch has to ignore. This is the
 * same arrangement `shoot.details` uses, and for the same reason: the jsonb
 * column is loose, the validation at the boundary is not.
 */
export const templateItemPayloadSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('shot'),
    title: z.string().trim().min(1, 'Title is required').max(200),
    description: longText.nullable().optional(),
    framing: shortText.nullable().optional(),
    subjects: shortText.nullable().optional(),
    props: shortText.nullable().optional(),
  }),
  z.object({
    kind: z.literal('checklist_item'),
    /**
     * The list this line belongs to, carried on the line itself.
     *
     * Template items are flat — one per line, not one per list — so every
     * copied row gets its own provenance and a diff can name the line that
     * changed. Grouping on apply is by (name, kind), which is why both
     * travel together here.
     */
    checklistName: name,
    checklistKind: checklistKindSchema,
    label,
    quantity: z.coerce.number().int().min(1).max(10_000).optional(),
  }),
])
export type TemplateItemPayload = z.infer<typeof templateItemPayloadSchema>

export const createTemplateSchema = z.object({
  id: z.uuid().optional(),
  name,
  /** Null suits any genre. */
  shootTypeKey: z.string().trim().min(1).max(50).nullable().optional(),
  notes: longText.nullable().optional(),
})
export type CreateTemplateInput = z.infer<typeof createTemplateSchema>

export const updateTemplateSchema = z.object({
  id: z.uuid(),
  name: name.optional(),
  shootTypeKey: z.string().trim().min(1).max(50).nullable().optional(),
  notes: longText.nullable().optional(),
})
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>

export const listTemplatesSchema = z.object({
  /** Offer the ones that suit the genre in hand. */
  shootTypeKey: z.string().trim().min(1).max(50).optional(),
  cursor: z.uuid().optional(),
  limit: queryNumber.int().min(1).max(200).default(100),
  updatedSince: z.coerce.date().optional(),
  includeDeleted: queryBoolean.default(false),
})
export type ListTemplatesInput = z.infer<typeof listTemplatesSchema>

export const templateIdSchema = z.object({ id: z.uuid() })

/**
 * Read a template with the contents of one version.
 *
 * Defaults to the current version, which is what an interface almost always
 * wants; an explicit number is for showing what a session was actually built
 * from, which may be several versions behind.
 */
export const getTemplateSchema = z.object({
  id: z.uuid(),
  version: queryNumber.int().min(1).optional(),
})
export type GetTemplateInput = z.infer<typeof getTemplateSchema>

/**
 * Publish a new version from a complete item list.
 *
 * The whole list, every time — there is no draft state and no per-item edit.
 * A version is created atomically or not at all, which is what makes "version
 * 2" mean exactly one thing forever. Editing a template is republishing it
 * with the list you want.
 */
export const publishTemplateVersionSchema = z.object({
  templateId: z.uuid(),
  items: z.array(templateItemPayloadSchema).min(1).max(500),
  /** What changed, for whoever reads the history later. */
  note: shortText.nullable().optional(),
})
export type PublishTemplateVersionInput = z.infer<typeof publishTemplateVersionSchema>

export const listTemplateVersionsSchema = z.object({
  templateId: z.uuid(),
  limit: queryNumber.int().min(1).max(100).default(50),
})
export type ListTemplateVersionsInput = z.infer<typeof listTemplateVersionsSchema>

/**
 * Copy a template version's contents into a session.
 *
 * `version` defaults to the template's current one. Applying twice is allowed
 * and additive — someone who applies a second template to the same session
 * means to combine them — so this is deliberately not idempotent on
 * (template, session). Guarding against a double submit is the client's job,
 * via the ids it mints.
 */
export const applyTemplateSchema = z.object({
  templateId: z.uuid(),
  sessionId: z.uuid(),
  version: queryNumber.int().min(1).optional(),
})
export type ApplyTemplateInput = z.infer<typeof applyTemplateSchema>

/**
 * Turn a session that worked into a template.
 *
 * This is how templates actually get written. Nobody sits down to author one
 * from nothing; they finish a shoot, notice they will do it again, and want
 * what they just built. Reads the session's shots and its shoot's checklists
 * and publishes them as version 1.
 */
export const saveSessionAsTemplateSchema = z.object({
  sessionId: z.uuid(),
  name,
  shootTypeKey: z.string().trim().min(1).max(50).nullable().optional(),
  notes: longText.nullable().optional(),
})
export type SaveSessionAsTemplateInput = z.infer<typeof saveSessionAsTemplateSchema>
