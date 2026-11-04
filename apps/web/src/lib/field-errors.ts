/**
 * Pull per-field messages out of a failed mutation.
 *
 * The API already reports exactly which field was wrong and why — genre
 * validation throws a ZodError that `packages/api/src/base.ts` maps to a
 * BAD_REQUEST carrying `data.issues`. The UI was showing only the top-level
 * message, so a negative approach time surfaced as "Validation failed" with
 * no indication of the field, the limit, or what to type instead. The
 * information was there the whole time and was being thrown away.
 *
 * Shaped defensively: this reads an error object from the wire, so every
 * level is checked rather than asserted. A malformed payload costs the
 * field-level detail, not the page.
 */

interface Issue {
  path: string[]
  message: string
}

/** Field name to the first message about it. */
export function fieldErrors(error: unknown): Record<string, string> {
  const issues = (error as { data?: { issues?: unknown } } | null)?.data?.issues
  if (!Array.isArray(issues)) return {}

  const byField: Record<string, string> = {}

  for (const raw of issues) {
    const issue = raw as Partial<Issue>
    if (!Array.isArray(issue.path) || typeof issue.message !== 'string') continue

    /**
     * Issues arrive pathed from the mutation input — `['details',
     * 'hikeMinutes']` — but the form knows its fields by bare name. The
     * last segment is the field, which also handles a nested shape if the
     * genre schemas ever grow one.
     */
    const name = issue.path.at(-1)
    if (typeof name !== 'string' || name in byField) continue

    byField[name] = issue.message
  }

  return byField
}

/**
 * A summary for when nothing could be attached to a field.
 *
 * Returns undefined when every issue found a home, so the form does not
 * repeat itself: showing "Validation failed" above a field that already
 * says "Too small: expected number to be >=0" adds noise, not information.
 */
export function unattributedError(error: unknown, shownFields: Set<string>): string | undefined {
  const byField = fieldErrors(error)
  const names = Object.keys(byField)

  if (names.length > 0 && names.every((name) => shownFields.has(name))) return undefined

  const message = (error as { message?: unknown } | null)?.message
  return typeof message === 'string' ? message : 'Something went wrong. Please try again.'
}
