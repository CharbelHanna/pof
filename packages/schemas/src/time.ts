/**
 * Wall-clock ↔ instant conversion for sessions.
 *
 * A session is planned as a wall-clock time in the place it happens ("06:00
 * at Glen Coe") but stored as an absolute instant. Converting between the two
 * is the part that is easy to get subtly wrong, so it lives here, is pure,
 * and is tested.
 *
 * Uses `Intl` rather than a date library: it is in every runtime we target
 * (browser, Node, React Native with full ICU), carries the IANA rules
 * including historical DST changes, and adds nothing to the bundle.
 */

/** The viewer's own zone. A sensible default when planning, not a fact about the shoot. */
export const browserTimezone: string =
  typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC'

/**
 * How far `timeZone` is from UTC at a given instant, in milliseconds.
 *
 * Derived by asking Intl what the wall clock reads there and comparing with
 * UTC. Must be computed per instant, not per zone: the answer changes across
 * a DST boundary, which is exactly when naive code breaks.
 */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant)

  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0')

  // Some engines render midnight as hour 24 rather than 0.
  const hour = read('hour') % 24

  const asIfUtc = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    hour,
    read('minute'),
    read('second'),
  )

  return asIfUtc - instant.getTime()
}

/**
 * Turn a `datetime-local` value ("2027-06-21T06:00") plus an IANA zone into
 * the instant it refers to.
 *
 * The offset is applied twice on purpose. The first pass uses the offset at a
 * provisional instant, which can be the wrong side of a DST transition; the
 * second re-reads the offset at the corrected instant and, if it changed,
 * recomputes. Without that, a session planned within an hour of a clock
 * change lands an hour out — rare, but it would be a missed sunrise call,
 * which is precisely the shoot where the hour matters most.
 */
export function toInstant(localDateTime: string, timeZone: string): Date {
  const [datePart = '', timePart = ''] = localDateTime.split('T')
  const [year, month, day] = datePart.split('-').map(Number)
  const [hour, minute] = timePart.split(':').map(Number)

  const asIfUtc = Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0)

  const firstGuess = new Date(asIfUtc - zoneOffsetMs(new Date(asIfUtc), timeZone))
  const settledOffset = zoneOffsetMs(firstGuess, timeZone)

  return new Date(asIfUtc - settledOffset)
}

/**
 * Render an instant as a `datetime-local` value in a given zone, so an input
 * shows the time the session actually happens rather than the viewer's time.
 */
export function localInputValue(instant: Date | string, timeZone: string): string {
  const date = typeof instant === 'string' ? new Date(instant) : instant

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date)

  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '00'

  const hour = String(Number(read('hour')) % 24).padStart(2, '0')

  return `${read('year')}-${read('month')}-${read('day')}T${hour}:${read('minute')}`
}

/**
 * Human-readable session time, always in the session's own zone.
 *
 * The zone abbreviation is included deliberately: a photographer planning
 * from another country needs to see that 06:00 is local to the shoot, not to
 * them. Dropping it is how people turn up an hour late.
 */
export function formatSessionTime(
  startsAt: Date | string,
  endsAt: Date | string,
  timeZone: string,
): string {
  const start = typeof startsAt === 'string' ? new Date(startsAt) : startsAt
  const end = typeof endsAt === 'string' ? new Date(endsAt) : endsAt

  const day = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(start)

  const time = (value: Date) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(value)

  const zone =
    new Intl.DateTimeFormat('en-GB', { timeZone, timeZoneName: 'short' })
      .formatToParts(start)
      .find((part) => part.type === 'timeZoneName')?.value ?? timeZone

  return `${day}, ${time(start)}–${time(end)} ${zone}`
}
