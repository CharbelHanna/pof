'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'

import { orpc } from '~/lib/api.ts'
import { formatSessionTime } from '~/lib/time.ts'

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
        <p className="text-ink-500 text-sm">
          Nothing scheduled. Add a session from a shoot to see it here.
        </p>
      )}
    </div>
  )
}

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
