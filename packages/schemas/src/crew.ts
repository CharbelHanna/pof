import { z } from 'zod'

/**
 * Crew contracts.
 *
 * A crew member is a role on a shoot, optionally named, optionally narrowed
 * to a single session.
 */

/**
 * Offered in the UI as suggestions, not enforced.
 *
 * Real crews invent roles — "digitech", "second shooter", "dog handler" — and
 * nothing in the system branches on this value, so constraining it would only
 * mean a migration every time someone hires a role nobody anticipated.
 */
export const CREW_ROLE_SUGGESTIONS = [
  'Photographer',
  'Assistant',
  'Second shooter',
  'Hair and makeup',
  'Stylist',
  'Producer',
  'Digitech',
  'Model',
  'Client',
] as const

const role = z.string().trim().min(1, 'Role is required').max(80)
const personName = z.string().trim().max(200)

const queryNumber = z.coerce.number()
const queryBoolean = z.union([z.boolean(), z.stringbool()])

export const createCrewMemberSchema = z.object({
  id: z.uuid().optional(),
  shootId: z.uuid(),
  /** Null means the whole shoot, which is the common case. */
  sessionId: z.uuid().nullable().optional(),
  role,
  name: personName.nullable().optional(),
  notes: z.string().max(10_000).nullable().optional(),
})
export type CreateCrewMemberInput = z.infer<typeof createCrewMemberSchema>

export const updateCrewMemberSchema = z.object({
  id: z.uuid(),
  sessionId: z.uuid().nullable().optional(),
  role: role.optional(),
  name: personName.nullable().optional(),
  notes: z.string().max(10_000).nullable().optional(),
})
export type UpdateCrewMemberInput = z.infer<typeof updateCrewMemberSchema>

export const listCrewSchema = z.object({
  shootId: z.uuid().optional(),
  cursor: z.uuid().optional(),
  limit: queryNumber.int().min(1).max(200).default(100),
  updatedSince: z.coerce.date().optional(),
  includeDeleted: queryBoolean.default(false),
})
export type ListCrewInput = z.infer<typeof listCrewSchema>

export const crewMemberIdSchema = z.object({ id: z.uuid() })
