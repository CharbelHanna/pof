'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { SESSION_STATUSES, newId, type SessionStatus } from '@pof/schemas'
import { useState } from 'react'

import { orpc } from '~/lib/api.ts'
import { useHydrated } from '~/lib/use-hydrated.ts'
import { formatSessionTime, localInputValue, toInstant, browserTimezone } from '~/lib/time.ts'

/** Sessions belonging to one shoot, with inline creation. */
export function SessionList({ shootId }: { shootId: string }) {
  const queryClient = useQueryClient()
  const input = { shootId, limit: 200, includeDeleted: false }

  const { data, isPending } = useQuery(orpc.sessions.list.queryOptions({ input }))

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: orpc.sessions.list.key() })

  const create = useMutation(orpc.sessions.create.mutationOptions({ onSuccess: invalidate }))
  const update = useMutation(orpc.sessions.update.mutationOptions({ onSuccess: invalidate }))
  const remove = useMutation(orpc.sessions.delete.mutationOptions({ onSuccess: invalidate }))

  const hydrated = useHydrated()
  const [name, setName] = useState('')
  const [startsAtLocal, setStartsAtLocal] = useState('')
  const [hours, setHours] = useState(2)
  // Defaults to the planner's own zone, which is right most of the time and
  // explicit enough to notice when it is not.
  const [timezone, setTimezone] = useState(browserTimezone)

  const sorted = [...(data?.items ?? [])].sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  )

  return (
    <section className="space-y-4">
      <h2 className="text-ink-500 text-xs font-medium tracking-wider uppercase">Sessions</h2>

      <form
        className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]"
        onSubmit={(event) => {
          event.preventDefault()
          if (!name.trim() || !startsAtLocal) return

          const startsAt = toInstant(startsAtLocal, timezone)

          create.mutate({
            id: newId(),
            shootId,
            name: name.trim(),
            status: 'planned',
            startsAt,
            endsAt: new Date(startsAt.getTime() + hours * 60 * 60 * 1000),
            timezone,
          })
          setName('')
          setStartsAtLocal('')
        }}
      >
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Session name"
          aria-label="Session name"
          className={inputClass}
        />
        <input
          type="datetime-local"
          value={startsAtLocal}
          onChange={(event) => setStartsAtLocal(event.target.value)}
          aria-label="Session start"
          className={inputClass}
        />
        <select
          value={hours}
          onChange={(event) => setHours(Number(event.target.value))}
          aria-label="Session length in hours"
          className={inputClass}
        >
          {[1, 2, 3, 4, 6, 8, 10, 12].map((value) => (
            <option key={value} value={value}>
              {value}h
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={!hydrated || create.isPending || !name.trim() || !startsAtLocal}
          className="bg-accent-600 hover:bg-accent-500 rounded-lg px-5 py-2.5 font-medium text-white transition-colors disabled:opacity-60"
        >
          Add
        </button>
      </form>

      <label className="block">
        <span className="text-ink-500 text-xs">
          Times are in <strong>{timezone}</strong> — the zone the session happens in, not yours.
        </span>
        <input
          value={timezone}
          onChange={(event) => setTimezone(event.target.value)}
          aria-label="Session timezone"
          className={`${inputClass} mt-1`}
          placeholder="Europe/London"
        />
      </label>

      {create.error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {create.error.message}
        </p>
      )}

      {isPending ? (
        <p className="text-ink-500 text-sm">Loading…</p>
      ) : sorted.length > 0 ? (
        <ul className="divide-ink-200 dark:divide-ink-800 divide-y">
          {sorted.map((session) => (
            <li key={session.id} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{session.name}</p>
                <p className="text-ink-500 mt-0.5 text-xs">
                  {formatSessionTime(session.startsAt, session.endsAt, session.timezone)}
                </p>
              </div>

              <select
                value={session.status}
                aria-label={`Status for ${session.name}`}
                onChange={(event) =>
                  update.mutate({
                    id: session.id,
                    status: event.target.value as SessionStatus,
                  })
                }
                className="border-ink-200 dark:border-ink-700 dark:bg-ink-900 rounded-md border bg-white px-2 py-1.5 text-sm"
              >
                {SESSION_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => remove.mutate({ id: session.id })}
                aria-label={`Delete ${session.name}`}
                className="text-ink-500 px-2 py-1.5 text-sm transition-colors hover:text-red-600"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ink-500 text-sm">No sessions yet. Add the first one above.</p>
      )}
    </section>
  )
}

const inputClass =
  'border-ink-200 dark:border-ink-700 dark:bg-ink-900 w-full rounded-lg border bg-white px-3 py-2.5 text-base outline-none focus:border-accent-500'
