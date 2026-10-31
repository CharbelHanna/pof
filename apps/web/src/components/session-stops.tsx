'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { LocationPicker } from '~/components/location-picker.tsx'
import { SunTimes } from '~/components/sun-times.tsx'
import { orpc } from '~/lib/api.ts'

/**
 * The places one session visits, in the order it visits them.
 *
 * A session used to hold a single location, which meant a route — park at the
 * layby, walk to the lochside for blue hour, climb to the ridge for sunrise —
 * had to be squeezed into a notes field. Those stops are now real rows, so
 * each one can carry its own access notes and the first can drive sun times.
 *
 * This component owns both the stop list and the sun times because it is the
 * only thing that knows which stop is first. Splitting them would mean two
 * components fetching the same rows to answer the same question.
 */
export function SessionStops({
  sessionId,
  on,
  timezone,
  fallbackLocationId,
}: {
  sessionId: string
  /** The session's start, used to pick the day for sun times. */
  on: Date
  timezone: string
  /** The shoot's primary location, used while a session has no stops of its own. */
  fallbackLocationId?: string | null
}) {
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)

  const input = { sessionId, limit: 100, includeDeleted: false }
  const { data } = useQuery(orpc.sessionLocations.list.queryOptions({ input }))

  const saved = useQuery(
    orpc.locations.list.queryOptions({ input: { limit: 200, includeDeleted: false } }),
  )

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: orpc.sessionLocations.list.key() })

  const add = useMutation(
    orpc.sessionLocations.add.mutationOptions({
      onSuccess: () => {
        setAdding(false)
        invalidate()
      },
    }),
  )
  const remove = useMutation(
    orpc.sessionLocations.remove.mutationOptions({ onSuccess: invalidate }),
  )

  // Position is the route order; the list endpoint sorts by id for a stable
  // cursor, so the ordering that matters is applied here.
  const stops = [...(data?.items ?? [])].sort((a, b) => a.position - b.position)

  const nameOf = (locationId: string) =>
    saved.data?.items.find((place) => place.id === locationId)?.name ?? 'Saved location'

  /** The first stop is where the session begins, so it decides the light. */
  const sunLocationId = stops[0]?.locationId ?? fallbackLocationId ?? null

  return (
    <div className="mt-1">
      {stops.length > 0 && (
        <ol className="mt-1 space-y-0.5">
          {stops.map((stop, index) => (
            <li key={stop.id} className="flex items-center gap-2 text-xs">
              <span className="text-ink-500 tabular-nums">{index + 1}.</span>
              <span className="text-ink-700 dark:text-ink-300 truncate">
                {nameOf(stop.locationId)}
              </span>
              <button
                type="button"
                onClick={() => remove.mutate({ id: stop.id })}
                aria-label={`Remove ${nameOf(stop.locationId)} from this session`}
                className="text-ink-500 transition-colors hover:text-red-600"
              >
                Remove
              </button>
            </li>
          ))}
        </ol>
      )}

      {adding ? (
        <div className="mt-2">
          <LocationPicker
            value={null}
            label="Add a stop"
            onChange={(locationId) => {
              if (locationId) add.mutate({ sessionId, locationId })
            }}
          />
          <button
            type="button"
            onClick={() => setAdding(false)}
            className="text-ink-500 mt-1 text-xs hover:underline"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="text-accent-600 dark:text-accent-400 mt-1 text-xs hover:underline"
        >
          {stops.length > 0 ? 'Add another stop' : 'Add a location'}
        </button>
      )}

      {add.error && (
        <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
          {add.error.message}
        </p>
      )}

      {sunLocationId && <SunTimes locationId={sunLocationId} on={on} timezone={timezone} />}
    </div>
  )
}
