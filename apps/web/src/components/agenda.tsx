'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { newId } from '@pof/schemas'
import { useState } from 'react'
import Link from 'next/link'

import { orpc } from '~/lib/api.ts'
import { useHydrated } from '~/lib/use-hydrated.ts'
import { browserTimezone, formatSessionTime, toInstant } from '~/lib/time.ts'

/**
 * Everything coming up, across every shoot — grouped by day.
 *
 * The agenda rather than a month grid, deliberately. A photographer's
 * question is "what is next and when do I need to leave", which a
 * chronological list answers directly; a calendar grid makes you decode it
 * from position, and on a phone shows a handful of unreadable cells.
 */
export function Agenda() {
  /**
   * Everything from today onwards, with no upper bound.
   *
   * An earlier version capped this at 90 days, which quietly hid anything
   * booked further out — editorial and campaign work is routinely planned
   * six months ahead, and those sessions appeared nowhere except their own
   * shoot. A planning tool that loses the far end of the plan is worse than
   * one that shows a long list.
   */
  const { data, isPending, error } = useQuery(
    orpc.sessions.list.queryOptions({
      input: {
        from: startOfToday(),
        limit: 200,
        includeDeleted: false,
      },
    }),
  )

  const sessions = [...(data?.items ?? [])].sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  )

  const days = groupByDay(sessions)

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Agenda</h1>
        <p className="text-ink-500 mt-1 text-sm">Everything coming up, across all your shoots.</p>
      </section>

      <NewSessionForm />

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error.message}
        </p>
      )}

      {isPending ? (
        <p className="text-ink-500 text-sm">Loading…</p>
      ) : days.length > 0 ? (
        <div className="space-y-6">
          {days.map(([day, items]) => (
            <section key={day}>
              <h2 className="text-ink-500 mb-2 text-xs font-medium tracking-wider uppercase">
                {day}
              </h2>
              <ul className="divide-ink-200 dark:divide-ink-800 divide-y">
                {items.map((session) => (
                  <li key={session.id} className="py-3">
                    <Link
                      href={`/shoots/${session.shootId}`}
                      className="block transition-opacity hover:opacity-70"
                    >
                      <p className="font-medium">{session.name}</p>
                      <p className="text-ink-500 mt-0.5 text-xs">
                        {formatSessionTime(session.startsAt, session.endsAt, session.timezone)} ·{' '}
                        {session.status}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <p className="text-ink-500 text-sm">Nothing scheduled yet.</p>
      )}
    </div>
  )
}

/**
 * Schedule a session without first navigating into its shoot.
 *
 * A session must belong to a shoot — that is a real constraint, not an
 * interface one — so this asks which. But requiring someone to remember which
 * shoot, navigate to it, and only then add the session was making the obvious
 * instinct ("I'm looking at my week, put something here") impossible.
 */
function NewSessionForm() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)

  const shootsQuery = useQuery(
    orpc.shoots.list.queryOptions({ input: { limit: 100, includeDeleted: false } }),
  )

  const create = useMutation(
    orpc.sessions.create.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: orpc.sessions.list.key() })
        setOpen(false)
      },
    }),
  )

  const hydrated = useHydrated()
  const [shootId, setShootId] = useState('')
  const [name, setName] = useState('')
  const [startsAtLocal, setStartsAtLocal] = useState('')
  const [hours, setHours] = useState(2)
  const [timezone, setTimezone] = useState(browserTimezone)

  const shoots = shootsQuery.data?.items ?? []

  if (!open) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={shoots.length === 0}
          className="bg-accent-600 hover:bg-accent-500 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-60"
        >
          Schedule a session
        </button>
        {shoots.length === 0 && (
          // The constraint stated plainly, rather than a button that silently
          // does nothing.
          <p className="text-ink-500 mt-2 text-xs">
            Create a shoot first — every session belongs to one.
          </p>
        )}
      </div>
    )
  }

  return (
    <form
      className="border-ink-200 dark:border-ink-800 space-y-3 rounded-lg border p-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (!shootId || !name.trim() || !startsAtLocal) return

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
      }}
    >
      <select
        value={shootId}
        onChange={(event) => setShootId(event.target.value)}
        aria-label="Shoot for new session"
        className={agendaControl}
      >
        <option value="">Which shoot?</option>
        {shoots.map((shoot) => (
          <option key={shoot.id} value={shoot.id}>
            {shoot.name}
          </option>
        ))}
      </select>

      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Session name"
        aria-label="New session name"
        className={agendaControl}
      />

      <div className="grid gap-2 sm:grid-cols-2">
        <input
          type="datetime-local"
          value={startsAtLocal}
          onChange={(event) => setStartsAtLocal(event.target.value)}
          aria-label="New session start"
          className={agendaControl}
        />
        <select
          value={hours}
          onChange={(event) => setHours(Number(event.target.value))}
          aria-label="New session length in hours"
          className={agendaControl}
        >
          {[1, 2, 3, 4, 6, 8, 10, 12].map((value) => (
            <option key={value} value={value}>
              {value}h
            </option>
          ))}
        </select>
      </div>

      <input
        value={timezone}
        onChange={(event) => setTimezone(event.target.value)}
        aria-label="New session timezone"
        className={agendaControl}
        placeholder="Europe/London"
      />
      <p className="text-ink-500 text-xs">
        Times are in <strong>{timezone}</strong> — the zone the session happens in, not yours.
      </p>

      {create.error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {create.error.message}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!hydrated || create.isPending || !shootId || !name.trim() || !startsAtLocal}
          className="bg-accent-600 hover:bg-accent-500 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-60"
        >
          {create.isPending ? 'Saving…' : 'Add session'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-ink-500 hover:text-ink-900 dark:hover:text-ink-100 px-4 py-2 text-sm"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

const agendaControl =
  'border-ink-200 dark:border-ink-700 dark:bg-ink-900 w-full rounded-lg border bg-white px-3 py-2.5 text-base outline-none focus:border-accent-500'

function startOfToday(): Date {
  const now = new Date()
  // The viewer's own midnight is the right boundary here: "today" in the
  // agenda means the user's today, even though each session renders in its
  // own zone.
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

type AgendaSession = {
  id: string
  shootId: string
  name: string
  status: string
  startsAt: Date | string
  endsAt: Date | string
  timezone: string
}

/**
 * Grouped by the day the session starts IN ITS OWN ZONE, so a 06:00 shoot in
 * Sydney files under its own date rather than being dragged into the
 * viewer's previous day.
 */
function groupByDay(sessions: AgendaSession[]): [string, AgendaSession[]][] {
  const groups = new Map<string, AgendaSession[]>()

  for (const session of sessions) {
    const label = new Intl.DateTimeFormat('en-GB', {
      timeZone: session.timezone,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).format(new Date(session.startsAt))

    groups.set(label, [...(groups.get(label) ?? []), session])
  }

  return [...groups.entries()]
}
