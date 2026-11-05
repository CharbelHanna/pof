'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CHECKLIST_KINDS,
  CHECKLIST_KIND_DESCRIPTIONS,
  CHECKLIST_KIND_LABELS,
  newId,
  type ChecklistKind,
} from '@pof/schemas'
import { useState } from 'react'

import { orpc } from '~/lib/api.ts'
import { useHydrated } from '~/lib/use-hydrated.ts'

/**
 * Checklists for this shoot.
 *
 * The counterpart to the shot list: shots are what you intend to come away
 * with, these are what has to be true before you can. Deliberately built for
 * one-handed use — the moment a gear list matters is in a car park at 05:00,
 * holding a bag in the other hand.
 */
export function Checklists({ shootId }: { shootId: string }) {
  const queryClient = useQueryClient()
  const hydrated = useHydrated()

  const { data, isPending } = useQuery(
    orpc.checklists.list.queryOptions({ input: { shootId, limit: 100, includeDeleted: false } }),
  )

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: orpc.checklists.list.key() })
  }

  const create = useMutation(orpc.checklists.create.mutationOptions({ onSuccess: invalidate }))

  const [name, setName] = useState('')
  const [kind, setKind] = useState<ChecklistKind>('gear')

  // Rendered in the order the user arranged, while the query pages by id.
  const lists = [...(data?.items ?? [])].sort((a, b) => a.position - b.position)

  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-ink-500 text-xs font-medium tracking-wider uppercase">Checklists</h2>
        {lists.length > 0 && (
          <span className="text-ink-500 text-xs">
            {lists.reduce((sum, list) => sum + list.doneCount, 0)} of{' '}
            {lists.reduce((sum, list) => sum + list.itemCount, 0)} done
          </span>
        )}
      </div>

      <form
        className="grid gap-2 sm:grid-cols-[1fr_auto_auto]"
        onSubmit={(event) => {
          event.preventDefault()
          if (!name.trim()) return
          create.mutate({ id: newId(), shootId, name: name.trim(), kind })
          setName('')
        }}
      >
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="New list — “Camera bag”, “Before the day”"
          aria-label="New checklist name"
          className={controlClass}
        />
        <select
          value={kind}
          onChange={(event) => setKind(event.target.value as ChecklistKind)}
          aria-label="Checklist kind"
          title={CHECKLIST_KIND_DESCRIPTIONS[kind]}
          className={controlClass}
        >
          {CHECKLIST_KINDS.map((value) => (
            <option key={value} value={value}>
              {CHECKLIST_KIND_LABELS[value]}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={!hydrated || create.isPending || !name.trim()}
          className="bg-accent-600 hover:bg-accent-500 rounded-lg px-5 py-2.5 font-medium text-white transition-colors disabled:opacity-60"
        >
          Add list
        </button>
      </form>

      {create.error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {create.error.message}
        </p>
      )}

      {isPending ? (
        <p className="text-ink-500 text-sm">Loading…</p>
      ) : lists.length > 0 ? (
        <div className="space-y-5">
          {lists.map((list) => (
            <ChecklistCard
              key={list.id}
              id={list.id}
              name={list.name}
              kind={list.kind}
              itemCount={list.itemCount}
              doneCount={list.doneCount}
            />
          ))}
        </div>
      ) : (
        <p className="text-ink-500 text-sm">
          No checklists yet. A gear list is usually the first one worth having.
        </p>
      )}
    </section>
  )
}

function ChecklistCard({
  id,
  name,
  kind,
  itemCount,
  doneCount,
}: {
  id: string
  name: string
  kind: ChecklistKind
  itemCount: number
  doneCount: number
}) {
  const queryClient = useQueryClient()
  const hydrated = useHydrated()

  const { data } = useQuery(
    orpc.checklistItems.list.queryOptions({
      input: { checklistId: id, limit: 500, includeDeleted: false },
    }),
  )

  /** Returns the promise so a caller can wait for the refetch to land. */
  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.checklistItems.list.key() }),
      // The parent's progress counts come from the list query, so that has to
      // refresh too or the header stays stale while the ticks move.
      queryClient.invalidateQueries({ queryKey: orpc.checklists.list.key() }),
    ])

  /**
   * Ticks the user has made but the server has not confirmed.
   *
   * Without this the checkbox is purely controlled by server state, so a tap
   * visibly does nothing until the round trip finishes and the list refetches.
   * On a desk that reads as sluggish; in a field on bad signal it reads as
   * broken, and people tap again — which is exactly where a checklist loses
   * the trust that makes it worth keeping.
   */
  const [pendingTicks, setPendingTicks] = useState<Record<string, boolean>>({})

  const clearPending = (itemId: string) =>
    setPendingTicks(({ [itemId]: _removed, ...rest }) => rest)

  const addMany = useMutation(
    orpc.checklistItems.addMany.mutationOptions({ onSuccess: invalidate }),
  )
  const setDone = useMutation(
    orpc.checklistItems.setDone.mutationOptions({
      /**
       * Returning the promise holds `onSettled` until the refetch has landed,
       * so the override is dropped only once real data agrees with it.
       * Clearing earlier makes the box flick back for a frame.
       */
      onSuccess: () => invalidate(),
      onSettled: (_data, _error, variables) => clearPending(variables.id),
    }),
  )
  const removeItem = useMutation(
    orpc.checklistItems.delete.mutationOptions({ onSuccess: invalidate }),
  )
  const removeList = useMutation(orpc.checklists.delete.mutationOptions({ onSuccess: invalidate }))

  const [draft, setDraft] = useState('')

  const items = [...(data?.items ?? [])].sort((a, b) => a.position - b.position)
  const complete = itemCount > 0 && doneCount === itemCount

  return (
    <div className="border-ink-200 dark:border-ink-800 rounded-xl border p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="flex min-w-0 items-baseline gap-2 font-medium">
          <span className="truncate">{name}</span>
          <span className="text-ink-500 shrink-0 text-xs tracking-wider uppercase">
            {CHECKLIST_KIND_LABELS[kind]}
          </span>
        </h3>
        {/*
          Labelled with the list it belongs to. "0 of 3" announced on its own
          tells a screen-reader user nothing, and on a shoot with several
          lists it is ambiguous to everyone.
        */}
        <span
          aria-label={`${name} progress`}
          className={`shrink-0 text-xs ${complete ? 'text-accent-600' : 'text-ink-500'}`}
        >
          {doneCount} of {itemCount}
        </span>
      </div>

      {items.length > 0 && (
        <ul className="divide-ink-200 dark:divide-ink-800 mt-3 divide-y">
          {items.map((item) => {
            // An unconfirmed tick wins over the server's answer, so the box
            // responds to the finger rather than to the network.
            const done = pendingTicks[item.id] ?? item.doneAt !== null
            return (
              <li key={item.id} className="flex items-center gap-3 py-3">
                {/*
                  A large target on purpose. This gets tapped with cold hands,
                  in the dark, by someone holding something else.
                */}
                <input
                  type="checkbox"
                  checked={done}
                  aria-label={`Done: ${item.label}`}
                  onChange={(event) => {
                    const next = event.target.checked
                    setPendingTicks((current) => ({ ...current, [item.id]: next }))
                    setDone.mutate({ id: item.id, done: next })
                  }}
                  className="accent-accent-600 size-6 shrink-0 rounded"
                />
                <span className={`min-w-0 flex-1 ${done ? 'text-ink-500 line-through' : ''}`}>
                  {item.label}
                  {item.quantity > 1 && ` ×${item.quantity}`}
                </span>
                <button
                  type="button"
                  onClick={() => removeItem.mutate({ id: item.id })}
                  aria-label={`Remove ${item.label}`}
                  className="text-ink-500 shrink-0 px-2 py-1.5 text-sm transition-colors hover:text-red-600"
                >
                  Remove
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {/*
        One line per item, submitted in a burst.

        A packing list is written from memory in one sitting, and a form that
        takes a single entry at a time turns that into forty round trips —
        enough friction that people reach for the notes app instead.
      */}
      <form
        className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]"
        onSubmit={(event) => {
          event.preventDefault()
          const labels = draft
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0)

          if (labels.length === 0) return
          addMany.mutate({ checklistId: id, labels })
          setDraft('')
        }}
      >
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={2}
          placeholder={'Add items, one per line\nBatteries\nCards\nTripod'}
          aria-label={`Add items to ${name}`}
          className={controlClass}
        />
        <button
          type="submit"
          disabled={!hydrated || addMany.isPending || draft.trim().length === 0}
          className="border-ink-200 dark:border-ink-700 hover:bg-ink-100 dark:hover:bg-ink-900 h-fit rounded-lg border px-5 py-2.5 font-medium transition-colors disabled:opacity-60"
        >
          Add
        </button>
      </form>

      {addMany.error && (
        <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
          {addMany.error.message}
        </p>
      )}

      <button
        type="button"
        onClick={() => removeList.mutate({ id })}
        aria-label={`Delete checklist ${name}`}
        className="text-ink-500 mt-3 text-sm transition-colors hover:text-red-600"
      >
        Delete list
      </button>
    </div>
  )
}

const controlClass =
  'border-ink-200 dark:border-ink-700 dark:bg-ink-900 w-full rounded-lg border bg-white px-3 py-2.5 text-base outline-none focus:border-accent-500'
