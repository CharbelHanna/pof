'use client'

import { useQuery } from '@tanstack/react-query'

import { orpc } from '~/lib/api.ts'

/**
 * The light at a location on a session's day.
 *
 * Computed on the server from the location's stored coordinates — no API, no
 * key, no rate limit. This is what the coordinates were for: a free-text
 * address could never produce it.
 *
 * Rendered in the SESSION's timezone, not the viewer's. Golden hour at 03:40
 * is only useful if it reads as 03:40 where the shoot is.
 */
export function SunTimes({
  locationId,
  on,
  timezone,
}: {
  locationId: string
  on: Date | string
  timezone: string
}) {
  const instant = typeof on === 'string' ? new Date(on) : on

  const { data, isPending, error } = useQuery(
    orpc.locations.sunTimes.queryOptions({ input: { locationId, on: instant } }),
  )

  if (isPending) return <p className="text-ink-500 text-xs">Checking the light…</p>
  if (error) return null
  if (!data) return null

  if (data.polar) {
    return (
      <p className="text-ink-500 text-xs">
        {data.polar === 'midnight-sun'
          ? 'Midnight sun — the sun does not set here on this date.'
          : 'Polar night — the sun does not rise here on this date.'}
      </p>
    )
  }

  if (!data.windows) {
    // Near the polar circles the sun can rise without civil twilight ever
    // occurring, so some windows have no meaningful times.
    return <p className="text-ink-500 text-xs">No usable twilight times for this date.</p>
  }

  const at = (value: Date | string) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(typeof value === 'string' ? new Date(value) : value)

  const windows: [string, { from: Date | string; to: Date | string }][] = [
    ['Blue hour', data.windows.blueHourMorning],
    ['Golden hour', data.windows.goldenHourMorning],
    ['Golden hour', data.windows.goldenHourEvening],
    ['Blue hour', data.windows.blueHourEvening],
  ]

  return (
    <div className="border-ink-200 dark:border-ink-800 mt-2 rounded-md border p-2.5">
      <p className="text-ink-500 mb-1.5 text-xs font-medium">
        Light at {data.locationName} · {timezone}
      </p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
        {windows.map(([label, window], index) => (
          <div key={`${label}-${index}`}>
            <dt className="text-ink-500">{label}</dt>
            <dd className="font-medium">
              {at(window.from)}–{at(window.to)}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-ink-500 mt-1.5 text-xs">
        Sunrise {at(data.times!.sunrise)} · Sunset {at(data.times!.sunset)}
      </p>
    </div>
  )
}
