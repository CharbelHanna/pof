'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useState } from 'react'
import type { ShotStatus } from '@pof/schemas'

import { orpc } from '~/lib/api.ts'
import { useWakeLock } from '~/lib/use-wake-lock.ts'

/**
 * On-set mode — the shoot as it is actually run.
 *
 * Everything else in this app is for planning, at a desk, with two hands.
 * This is the one surface used while working: outdoors, one-handed, often in
 * the dark, sometimes in gloves, with the other hand holding a camera. That
 * changes the rules rather than the styling — targets are large, the chrome
 * is gone, nothing needs typing, and the screen is held awake.
 *
 * It deliberately shows only what is in front of you: the shots still to get
 * and the lists not yet finished. Planning lives one tap away on the shoot
 * page, where there is time for it.
 */
export function OnSet({ shootId }: { shootId: string }) {
  const queryClient = useQueryClient()
  const { held, supported } = useWakeLock()

  const shoot = useQuery(orpc.shoots.get.queryOptions({ input: { id: shootId } }))
  const shots = useQuery(
    orpc.shots.list.queryOptions({ input: { shootId, limit: 200, includeDeleted: false } }),
  )
  const sessions = useQuery(
    orpc.sessions.list.queryOptions({ input: { shootId, limit: 200, includeDeleted: false } }),
  )
  const checklists = useQuery(
    orpc.checklists.list.queryOptions({ input: { shootId, limit: 100, includeDeleted: false } }),
  )

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.shots.list.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.checklists.list.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.checklistItems.list.key() }),
    ])

  /**
   * Status changes the user has made but the server has not confirmed.
   *
   * Same reasoning as the checklist ticks: on set the network is whatever the
   * location gives you, and a button that does nothing visible for a second
   * gets pressed again. The override is dropped once the refetch agrees.
   */
  const [pendingStatus, setPendingStatus] = useState<Record<string, ShotStatus>>({})

  const update = useMutation(
    orpc.shots.update.mutationOptions({
      onSuccess: () => invalidate(),
      onSettled: (_data, _error, variables) =>
        setPendingStatus(({ [variables.id]: _removed, ...rest }) => rest),
    }),
  )

  const [sessionFilter, setSessionFilter] = useState<string>('')
  const [showDone, setShowDone] = useState(false)

  const sessionList = [...(sessions.data?.items ?? [])].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
  )

  const allShots = [...(shots.data?.items ?? [])]
    .sort((a, b) => a.position - b.position)
    .map((shot) => ({ ...shot, status: pendingStatus[shot.id] ?? shot.status }))

  const forSession = sessionFilter
    ? allShots.filter((shot) => shot.sessionId === sessionFilter)
    : allShots

  const remaining = forSession.filter((shot) => shot.status === 'planned')
  const done = forSession.filter((shot) => shot.status !== 'planned')
  const visible = showDone ? forSession : remaining

  const capturedCount = forSession.filter((shot) => shot.status === 'captured').length

  function setStatus(id: string, status: ShotStatus) {
    setPendingStatus((current) => ({ ...current, [id]: status }))
    update.mutate({ id, status })
  }

  const lists = [...(checklists.data?.items ?? [])]
    .sort((a, b) => a.position - b.position)
    .filter((list) => list.itemCount > list.doneCount)

  return (
    <div className="min-h-dvh pb-24">
      <header className="border-ink-200 dark:border-ink-800 mb-4 border-b pb-3">
        <div className="flex items-baseline justify-between gap-3">
          <Link href={`/shoots/${shootId}`} className="text-ink-500 text-sm hover:underline">
            ← Back to planning
          </Link>
          {/*
            Said plainly either way. Someone told the screen stays on will put
            the phone down expecting it to, so silence when the lock was
            refused is worse than admitting it.
          */}
          <span className="text-ink-500 text-xs" aria-label="Screen state">
            {held ? 'Screen staying on' : supported ? 'Screen will sleep' : ''}
          </span>
        </div>

        <h1 className="mt-2 text-xl font-semibold tracking-tight">
          {shoot.data?.name ?? 'On set'}
        </h1>

        <p className="text-ink-500 mt-1 text-sm" aria-label="Shots captured">
          {capturedCount} of {forSession.length} captured
          {remaining.length > 0 && ` · ${remaining.length} to go`}
        </p>
      </header>

      {sessionList.length > 0 && (
        <select
          value={sessionFilter}
          onChange={(event) => setSessionFilter(event.target.value)}
          aria-label="Session"
          className="border-ink-200 dark:border-ink-700 dark:bg-ink-900 mb-4 w-full rounded-lg border bg-white px-3 py-3 text-base"
        >
          <option value="">All shots</option>
          {sessionList.map((session) => (
            <option key={session.id} value={session.id}>
              {session.name}
            </option>
          ))}
        </select>
      )}

      {visible.length > 0 ? (
        <ol className="space-y-3">
          {visible.map((shot) => (
            <li
              key={shot.id}
              className={`border-ink-200 dark:border-ink-800 rounded-xl border p-4 ${
                shot.status !== 'planned' ? 'opacity-60' : ''
              }`}
            >
              <p className="text-lg font-medium">{shot.title}</p>

              {/*
                The brief, readable without tapping. On set you need to know
                what the frame is supposed to be, and opening a detail panel
                one-handed while holding a camera is not realistic.
              */}
              {(shot.framing ?? shot.subjects) && (
                <p className="text-ink-500 mt-1 text-sm">
                  {[shot.framing, shot.subjects].filter(Boolean).join(' · ')}
                </p>
              )}
              {shot.description && <p className="mt-2 text-sm">{shot.description}</p>}

              {/*
                Large, separated, and labelled — not a swipe.

                The plan called for swipe-to-complete; buttons won because a
                swipe is invisible until discovered, unreachable by keyboard
                or screen reader, and fires by accident while scrolling a
                list with cold hands. The gesture can be added on top later
                without taking these away.
              */}
              <div className="mt-4 grid grid-cols-2 gap-2">
                {shot.status === 'planned' ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setStatus(shot.id, 'captured')}
                      aria-label={`Captured: ${shot.title}`}
                      className="bg-accent-600 hover:bg-accent-500 rounded-xl px-4 py-4 text-base font-medium text-white transition-colors"
                    >
                      Got it
                    </button>
                    <button
                      type="button"
                      onClick={() => setStatus(shot.id, 'skipped')}
                      aria-label={`Skip: ${shot.title}`}
                      className="border-ink-200 dark:border-ink-700 hover:bg-ink-100 dark:hover:bg-ink-900 rounded-xl border px-4 py-4 text-base font-medium transition-colors"
                    >
                      Skip
                    </button>
                  </>
                ) : (
                  <>
                    <span className="text-ink-500 self-center text-sm">
                      {shot.status === 'captured' ? 'Captured' : 'Skipped'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setStatus(shot.id, 'planned')}
                      aria-label={`Undo: ${shot.title}`}
                      className="border-ink-200 dark:border-ink-700 hover:bg-ink-100 dark:hover:bg-ink-900 rounded-xl border px-4 py-3 text-base font-medium transition-colors"
                    >
                      Undo
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-ink-500 py-8 text-center">
          {forSession.length === 0
            ? 'No shots on this list yet.'
            : 'Every shot accounted for. Nice one.'}
        </p>
      )}

      {done.length > 0 && (
        <button
          type="button"
          onClick={() => setShowDone((current) => !current)}
          aria-expanded={showDone}
          className="text-ink-500 hover:text-accent-600 mt-5 w-full py-3 text-sm transition-colors"
        >
          {showDone ? 'Hide finished' : `Show ${done.length} finished`}
        </button>
      )}

      {lists.length > 0 && (
        <section className="mt-8 space-y-4">
          <h2 className="text-ink-500 text-xs font-medium tracking-wider uppercase">Still to do</h2>
          {lists.map((list) => (
            <OnSetChecklist key={list.id} id={list.id} name={list.name} onChange={invalidate} />
          ))}
        </section>
      )}
    </div>
  )
}

/** One unfinished checklist, showing only the items still outstanding. */
function OnSetChecklist({
  id,
  name,
  onChange,
}: {
  id: string
  name: string
  onChange: () => Promise<unknown>
}) {
  const { data } = useQuery(
    orpc.checklistItems.list.queryOptions({
      input: { checklistId: id, limit: 500, includeDeleted: false },
    }),
  )

  const [pending, setPending] = useState<Record<string, boolean>>({})

  const setDone = useMutation(
    orpc.checklistItems.setDone.mutationOptions({
      onSuccess: () => onChange(),
      onSettled: (_data, _error, variables) =>
        setPending(({ [variables.id]: _removed, ...rest }) => rest),
    }),
  )

  const items = [...(data?.items ?? [])]
    .sort((a, b) => a.position - b.position)
    .map((item) => ({ ...item, done: pending[item.id] ?? item.doneAt !== null }))

  const outstanding = items.filter((item) => !item.done)
  if (outstanding.length === 0) return null

  return (
    <div className="border-ink-200 dark:border-ink-800 rounded-xl border p-4">
      <h3 className="font-medium">{name}</h3>
      <ul className="divide-ink-200 dark:divide-ink-800 mt-2 divide-y">
        {outstanding.map((item) => (
          <li key={item.id}>
            {/*
              The whole row is the target, not just the box. One-handed, in
              the dark, aiming at a 24px square is the difference between
              using the list and giving up on it.
            */}
            <button
              type="button"
              onClick={() => {
                setPending((current) => ({ ...current, [item.id]: true }))
                setDone.mutate({ id: item.id, done: true })
              }}
              aria-label={`Done: ${item.label}`}
              className="hover:bg-ink-100 dark:hover:bg-ink-900 flex w-full items-center gap-3 rounded-lg py-4 text-left text-base transition-colors"
            >
              <span
                aria-hidden="true"
                className="border-ink-300 dark:border-ink-600 size-6 shrink-0 rounded border"
              />
              <span className="min-w-0 flex-1">
                {item.label}
                {item.quantity > 1 && ` ×${item.quantity}`}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
