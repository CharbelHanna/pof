import { z } from 'zod'

/**
 * Session contracts.
 *
 * A session is a single block of shooting time. Timezone handling is the part
 * worth reading carefully.
 */

export const SESSION_STATUSES = [
  'planned',
  'confirmed',
  'in_progress',
  'completed',
  'cancelled',
] as const
export const sessionStatusSchema = z.enum(SESSION_STATUSES)
export type SessionStatus = z.infer<typeof sessionStatusSchema>

const sessionName = z.string().trim().min(1, 'Name is required').max(200)

const queryNumber = z.coerce.number()
const queryBoolean = z.union([z.boolean(), z.stringbool()])

/**
 * An IANA timezone identifier — "Europe/London", not "GMT" or "+01:00".
 *
 * A fixed offset is not good enough: it is wrong half the year, and a session
 * planned in January for a shoot in July would be off by an hour. The zone
 * name carries the DST rules with it.
 *
 * Validated against the runtime's own timezone database rather than a regex,
 * so a well-formed but non-existent zone ("Europe/Atlantis") is rejected.
 */
export const timezoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(isValidTimezone, { message: 'Not a recognised timezone' })

function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

/**
 * A session that ends before it starts is always a bug — typically an end
 * time edited without re-checking the start. The database enforces it too;
 * checking here produces a field-level message instead of a constraint error.
 */
const orderedTimes = <T extends { startsAt?: Date; endsAt?: Date }>(
  value: T,
  ctx: z.RefinementCtx,
) => {
  if (value.startsAt && value.endsAt && value.endsAt <= value.startsAt) {
    ctx.addIssue({
      code: 'custom',
      path: ['endsAt'],
      message: 'The session must end after it starts',
    })
  }
}

export const createSessionSchema = z
  .object({
    id: z.uuid().optional(),
    shootId: z.uuid(),
    name: sessionName,
    status: sessionStatusSchema.default('planned'),
    /** Absolute instants. The timezone below says how to display them. */
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    timezone: timezoneSchema.default('UTC'),
    notes: z.string().max(10_000).optional(),
  })
  .superRefine(orderedTimes)
export type CreateSessionInput = z.infer<typeof createSessionSchema>

export const updateSessionSchema = z
  .object({
    id: z.uuid(),
    name: sessionName.optional(),
    status: sessionStatusSchema.optional(),
    startsAt: z.coerce.date().optional(),
    endsAt: z.coerce.date().optional(),
    timezone: timezoneSchema.optional(),
    notes: z.string().max(10_000).nullable().optional(),
  })
  .superRefine(orderedTimes)
export type UpdateSessionInput = z.infer<typeof updateSessionSchema>

export const listSessionsSchema = z.object({
  /** Narrow to one shoot. Omit for the whole workspace — the agenda view. */
  shootId: z.uuid().optional(),
  /** Window for the calendar and agenda views. */
  from: z.coerce.date().optional(),
  until: z.coerce.date().optional(),
  cursor: z.uuid().optional(),
  limit: queryNumber.int().min(1).max(200).default(100),
  updatedSince: z.coerce.date().optional(),
  includeDeleted: queryBoolean.default(false),
})
export type ListSessionsInput = z.infer<typeof listSessionsSchema>

export const sessionIdSchema = z.object({ id: z.uuid() })
