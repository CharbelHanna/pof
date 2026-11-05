'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { newId, SHOT_FRAMING_SUGGESTIONS, SHOT_STATUSES, type ShotStatus } from '@pof/schemas'
import { useEffect, useId, useState } from 'react'

import { orpc } from '~/lib/api.ts'
import { useHydrated } from '~/lib/use-hydrated.ts'

/**
 * The shot list — the frames this shoot is supposed to come away with.
 *
 * This is the unit the work is measured in. A shoot is booked and a session is
 * scheduled, but a shot is the thing that either got captured or did not, and
 * it is what a client asks about afterwards. The running order is the plan for
 * the day, so it is arranged by hand rather than derived from anything.
 */
export function ShotList({ shootId }: { shootId: string }) {
  const queryClient = useQueryClient()
  const hydrated = useHydrated()
  const framingListId = useId()

  const shots = useQuery(
    orpc.shots.list.queryOptions({ input: { shootId, limit: 200, includeDeleted: false } }),
  )
  const sessions = useQuery(
    orpc.sessions.list.queryOptions({ input: { shootId, limit: 200, includeDeleted: false } }),
  )

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: orpc.shots.list.key() })
  }

  const create = useMutation(orpc.shots.create.mutationOptions({ onSuccess: invalidate }))
  const update = useMutation(orpc.shots.update.mutationOptions({ onSuccess: invalidate }))
  const remove = useMutation(orpc.shots.delete.mutationOptions({ onSuccess: invalidate }))
  const reorder = useMutation(orpc.shots.reorder.mutationOptions({ onSuccess: invalidate }))

  const [title, setTitle] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const [dragOrder, setDragOrder] = useState<string[] | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)

  useEffect(() => {
    // Adding or deleting a shot changes the set, so a stale local order would
    // drop or duplicate a row. Server order wins whenever it changes.
    setDragOrder(null)
  }, [shots.dataUpdatedAt])

  const serverOrder = [...(shots.data?.items ?? [])].sort((a, b) => a.position - b.position)

  const sorted = dragOrder
    ? dragOrder
        .map((id) => serverOrder.find((shot) => shot.id === id))
        .filter((shot): shot is (typeof serverOrder)[number] => shot !== undefined)
    : serverOrder

  const sessionList = [...(sessions.data?.items ?? [])].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
  )
  const capturedCount = serverOrder.filter((shot) => shot.status === 'captured').length

  /** Move a shot to a new index, by id, without mutating state in place. */
  function reposition(ids: string[], id: string, to: number): string[] {
    const from = ids.indexOf(id)
    if (from === -1 || to < 0 || to >= ids.length || from === to) return ids
    const next = [...ids]
    next.splice(from, 1)
    next.splice(to, 0, id)
    return next
  }

  /**
   * Persist the arrangement.
   *
   * One call with the full order, not a patch per shot: moving one shot
   * changes the position of every shot it passed, and the endpoint rejects a
   * partial list for exactly that reason.
   */
  function commit(ids: string[]) {
    const unchanged = ids.every((id, index) => serverOrder[index]?.id === id)
    if (unchanged) return
    reorder.mutate({ shootId, orderedIds: ids })
  }

  function moveBy(id: string, delta: number) {
    const ids = sorted.map((shot) => shot.id)
    const next = reposition(ids, id, ids.indexOf(id) + delta)
    if (next === ids) return
    setDragOrder(next)
    commit(next)
  }

  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-ink-500 text-xs font-medium tracking-wider uppercase">Shots</h2>
        {serverOrder.length > 0 && (
          <span aria-label="Shots captured" className="text-ink-500 text-xs">
            {capturedCount} of {serverOrder.length} captured
          </span>
        )}
      </div>

      <form
        className="grid gap-2 sm:grid-cols-[1fr_auto]"
        onSubmit={(event) => {
          event.preventDefault()
          if (!title.trim()) return
          create.mutate({
            id: newId(),
            shootId,
            title: title.trim(),
            status: 'planned',
          })
          setTitle('')
        }}
      >
        {/*
          Title only. A shot is created in a hurry, often several in a row,
          and the session it belongs to is usually not decided yet — which is
          why `session_id` is nullable in the first place. Assigning one lives
          in the details panel, for the minority of shots that need it.
        */}
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="New shot — “Wide establishing frame”"
          aria-label="Shot title"
          className={controlClass}
        />
        <button
          type="submit"
          disabled={!hydrated || create.isPending || !title.trim()}
          className="bg-accent-600 hover:bg-accent-500 rounded-lg px-5 py-2.5 font-medium text-white transition-colors disabled:opacity-60"
        >
          Add shot
        </button>
      </form>

      {(create.error ?? reorder.error) && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {reorder.error ? 'Could not save the new order. ' : ''}
          {(create.error ?? reorder.error)?.message}
        </p>
      )}

      <datalist id={framingListId}>
        {SHOT_FRAMING_SUGGESTIONS.map((suggestion) => (
          <option key={suggestion} value={suggestion} />
        ))}
      </datalist>

      {shots.isPending ? (
        <p className="text-ink-500 text-sm">Loading…</p>
      ) : sorted.length > 0 ? (
        <ol className="space-y-2">
          {sorted.map((shot, index) => {
            const isOpen = expanded === shot.id
            return (
              <li
                key={shot.id}
                data-shot-id={shot.id}
                className={`border-ink-200 dark:border-ink-800 rounded-xl border p-3 transition-opacity ${
                  draggingId === shot.id ? 'opacity-60' : ''
                }`}
              >
                <div className="flex items-center gap-2">
                  {/*
                    A dedicated handle rather than dragging the whole row.
                    `touch-action: none` is what lets a pointer drag beat the
                    browser's scrolling, and putting that on the row would
                    make the list unscrollable on a phone.
                  */}
                  <button
                    type="button"
                    aria-label={`Reorder shot ${index + 1} of ${sorted.length}`}
                    onPointerDown={(event) => {
                      event.preventDefault()
                      setDraggingId(shot.id)
                      event.currentTarget.setPointerCapture(event.pointerId)
                      setDragOrder(sorted.map((s) => s.id))
                    }}
                    onPointerMove={(event) => {
                      if (draggingId !== shot.id) return

                      /*
                       * Hit-test what is under the pointer rather than
                       * tracking geometry. Rows change height as details
                       * open and titles wrap, so computed offsets would be
                       * wrong the moment anything expanded.
                       */
                      const under = document
                        .elementFromPoint(event.clientX, event.clientY)
                        ?.closest('[data-shot-id]')
                      const overId = under?.getAttribute('data-shot-id')
                      if (!overId || overId === shot.id) return

                      setDragOrder((current) => {
                        const ids = current ?? sorted.map((s) => s.id)
                        return reposition(ids, shot.id, ids.indexOf(overId))
                      })
                    }}
                    onPointerUp={() => {
                      if (draggingId !== shot.id) return
                      setDraggingId(null)
                      commit(sorted.map((s) => s.id))
                    }}
                    onPointerCancel={() => {
                      // A cancelled gesture must not leave a half-applied order.
                      setDraggingId(null)
                      setDragOrder(null)
                    }}
                    onKeyDown={(event) => {
                      /*
                       * Dragging is unreachable by keyboard, so the same
                       * handle moves the shot with the arrow keys. Without
                       * this the running order — the plan for the day —
                       * would be mouse-and-touch only.
                       */
                      if (event.key === 'ArrowUp') {
                        event.preventDefault()
                        moveBy(shot.id, -1)
                      } else if (event.key === 'ArrowDown') {
                        event.preventDefault()
                        moveBy(shot.id, 1)
                      }
                    }}
                    className="text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-900 shrink-0 cursor-grab touch-none rounded px-2 py-1.5 text-xs active:cursor-grabbing"
                  >
                    Drag
                  </button>

                  <input
                    defaultValue={shot.title}
                    aria-label={`Title for ${shot.title}`}
                    onBlur={(event) => {
                      const next = event.target.value.trim()
                      if (!next || next === shot.title) {
                        event.target.value = shot.title
                        return
                      }
                      update.mutate({ id: shot.id, title: next })
                    }}
                    className="focus:border-accent-500 min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1.5 font-medium outline-none"
                  />

                  <select
                    value={shot.status}
                    aria-label={`Status for ${shot.title}`}
                    onChange={(event) =>
                      update.mutate({ id: shot.id, status: event.target.value as ShotStatus })
                    }
                    className="border-ink-200 dark:border-ink-700 dark:bg-ink-900 shrink-0 rounded-md border bg-white px-2 py-1.5 text-sm"
                  >
                    {SHOT_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : shot.id)}
                    aria-expanded={isOpen}
                    aria-label={`Details for ${shot.title}`}
                    className="text-ink-500 hover:text-accent-600 shrink-0 px-2 py-1.5 text-sm transition-colors"
                  >
                    {isOpen ? 'Less' : 'Details'}
                  </button>
                </div>

                {isOpen && (
                  <div className="mt-3 grid gap-2 pl-2 sm:grid-cols-2">
                    <Field
                      label="Framing"
                      shotTitle={shot.title}
                      value={shot.framing}
                      listId={framingListId}
                      onCommit={(value) => update.mutate({ id: shot.id, framing: value })}
                    />
                    <Field
                      label="Subjects"
                      shotTitle={shot.title}
                      value={shot.subjects}
                      onCommit={(value) => update.mutate({ id: shot.id, subjects: value })}
                    />
                    <Field
                      label="Props"
                      shotTitle={shot.title}
                      value={shot.props}
                      onCommit={(value) => update.mutate({ id: shot.id, props: value })}
                    />

                    <label className="text-ink-500 block text-xs">
                      Session
                      <select
                        value={shot.sessionId ?? ''}
                        onChange={(event) =>
                          update.mutate({
                            id: shot.id,
                            sessionId: event.target.value === '' ? null : event.target.value,
                          })
                        }
                        aria-label={`Session for ${shot.title}`}
                        className={`${controlClass} mt-1`}
                      >
                        <option value="">Whole shoot</option>
                        {sessionList.map((session) => (
                          <option key={session.id} value={session.id}>
                            {session.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="text-ink-500 block text-xs sm:col-span-2">
                      Description
                      <textarea
                        defaultValue={shot.description ?? ''}
                        rows={2}
                        aria-label={`Description for ${shot.title}`}
                        onBlur={(event) => {
                          const next = event.target.value.trim()
                          if (next === (shot.description ?? '')) return
                          update.mutate({ id: shot.id, description: next === '' ? null : next })
                        }}
                        className={`${controlClass} mt-1`}
                      />
                    </label>

                    <div className="sm:col-span-2">
                      <button
                        type="button"
                        onClick={() => remove.mutate({ id: shot.id })}
                        aria-label={`Delete ${shot.title}`}
                        className="text-ink-500 text-sm transition-colors hover:text-red-600"
                      >
                        Delete shot
                      </button>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      ) : (
        <p className="text-ink-500 text-sm">
          No shots yet. The running order here is the plan for the day.
        </p>
      )}
    </section>
  )
}

/**
 * A small labelled text field that saves on blur.
 *
 * The accessible name carries the shot, not just the field. Someone tabbing
 * through an expanded row otherwise hears "Framing" with no idea which shot
 * it belongs to — and "Subjects" alone collides with the portrait genre's
 * own "Number of subjects" field further up the same page.
 */
function Field({
  label,
  shotTitle,
  value,
  listId,
  onCommit,
}: {
  label: string
  shotTitle: string
  value: string | null
  listId?: string
  onCommit: (value: string | null) => void
}) {
  return (
    <label className="text-ink-500 block text-xs">
      {label}
      <input
        defaultValue={value ?? ''}
        list={listId}
        aria-label={`${label} for ${shotTitle}`}
        onBlur={(event) => {
          const next = event.target.value.trim()
          if (next === (value ?? '')) return
          onCommit(next === '' ? null : next)
        }}
        className={`${controlClass} mt-1`}
      />
    </label>
  )
}

const controlClass =
  'border-ink-200 dark:border-ink-700 dark:bg-ink-900 w-full rounded-lg border bg-white px-3 py-2.5 text-base outline-none focus:border-accent-500'
