'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { newId } from '@pof/schemas'
import { useEffect, useState } from 'react'

import { orpc } from '~/lib/api.ts'
import { useHydrated } from '~/lib/use-hydrated.ts'

/**
 * Choose a location: either one already saved, or a new one found by search.
 *
 * Search is debounced at 600ms rather than fired per keystroke. That is a
 * policy obligation, not a performance tweak — Nominatim treats periodic
 * type-ahead requests as bulk geocoding and discourages them, and Photon
 * throttles extensive use. Results are also cached server-side, which the
 * same policy requires.
 */
export function LocationPicker({
  value,
  onChange,
  label = 'Location',
}: {
  value: string | null
  onChange: (locationId: string | null) => void
  label?: string
}) {
  const queryClient = useQueryClient()
  const hydrated = useHydrated()

  const saved = useQuery(
    orpc.locations.list.queryOptions({ input: { limit: 200, includeDeleted: false } }),
  )

  const [searching, setSearching] = useState(false)
  const [term, setTerm] = useState('')
  const [debounced, setDebounced] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term.trim()), 600)
    return () => clearTimeout(timer)
  }, [term])

  const results = useQuery({
    ...orpc.locations.search.queryOptions({ input: { query: debounced, limit: 8 } }),
    enabled: hydrated && searching && debounced.length >= 3,
    // Results do not change minute to minute, and re-asking is exactly what
    // the usage policy objects to.
    staleTime: 10 * 60 * 1000,
    retry: false,
  })

  const create = useMutation(
    orpc.locations.create.mutationOptions({
      onSuccess: (created) => {
        void queryClient.invalidateQueries({ queryKey: orpc.locations.list.key() })
        onChange(created.id)
        setSearching(false)
        setTerm('')
      },
    }),
  )

  if (!searching) {
    return (
      <div className="space-y-2">
        <div className="flex gap-2">
          <select
            value={value ?? ''}
            aria-label={label}
            onChange={(event) => onChange(event.target.value || null)}
            className={controlClass}
          >
            <option value="">No location</option>
            {saved.data?.items.map((place) => (
              <option key={place.id} value={place.id}>
                {place.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setSearching(true)}
            className="border-ink-200 dark:border-ink-700 hover:bg-ink-100 dark:hover:bg-ink-900 shrink-0 rounded-lg border px-4 py-2 text-sm font-medium transition-colors"
          >
            Find a place
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="border-ink-200 dark:border-ink-800 space-y-3 rounded-lg border p-3">
      <input
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        placeholder="Search for a place, e.g. Glen Coe"
        aria-label="Search for a place"
        autoFocus
        className={controlClass}
      />

      {results.isFetching && <p className="text-ink-500 text-sm">Searching…</p>}

      {results.error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {/* Free geocoders offer no availability guarantee, so an outage is
              an expected state. Say what to do about it. */}
          Place search is unavailable right now. You can pick a saved location instead, or try again
          shortly.
        </p>
      )}

      {results.data && results.data.results.length === 0 && debounced.length >= 3 && (
        <p className="text-ink-500 text-sm">Nothing found for “{debounced}”.</p>
      )}

      {results.data && results.data.results.length > 0 && (
        <>
          <ul className="divide-ink-200 dark:divide-ink-800 divide-y">
            {results.data.results.map((place) => (
              <li key={`${place.latitude},${place.longitude}`}>
                <button
                  type="button"
                  disabled={create.isPending}
                  onClick={() =>
                    create.mutate({
                      id: newId(),
                      name: place.name,
                      address: place.address,
                      latitude: place.latitude,
                      longitude: place.longitude,
                      provider: 'osm',
                      ...(place.providerId ? { providerId: place.providerId } : {}),
                      permitRequired: false,
                    })
                  }
                  className="hover:bg-ink-100 dark:hover:bg-ink-900 w-full px-2 py-2.5 text-left transition-colors"
                >
                  <span className="block font-medium">{place.name}</span>
                  <span className="text-ink-500 block text-xs">{place.address}</span>
                </button>
              </li>
            ))}
          </ul>
          {/* Attribution is a licence obligation for OSM-derived data, which
              is why the port carries it rather than leaving it to a view. */}
          <p className="text-ink-500 text-xs">{results.data.attribution}</p>
        </>
      )}

      <button
        type="button"
        onClick={() => {
          setSearching(false)
          setTerm('')
        }}
        className="text-ink-500 hover:text-ink-900 dark:hover:text-ink-100 text-sm"
      >
        Cancel
      </button>
    </div>
  )
}

const controlClass =
  'border-ink-200 dark:border-ink-700 dark:bg-ink-900 w-full rounded-lg border bg-white px-3 py-2 text-base outline-none focus:border-accent-500'
