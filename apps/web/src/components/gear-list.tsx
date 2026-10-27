'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { GEAR_CATEGORY_SUGGESTIONS, newId } from '@pof/schemas'
import { useId, useState } from 'react'

import { orpc } from '~/lib/api.ts'
import { useHydrated } from '~/lib/use-hydrated.ts'

/**
 * Gear for this shoot, chosen from the workspace's library.
 *
 * Picking from a library rather than typing free text is what makes "my 85mm"
 * one thing across every shoot. Kit not yet in the library can be added from
 * here in one step, so the library fills up as a side effect of planning
 * rather than needing to be set up first.
 */
export function GearList({ shootId }: { shootId: string }) {
  const queryClient = useQueryClient()
  const hydrated = useHydrated()
  const categoryListId = useId()

  const { data, isPending } = useQuery(
    orpc.shootGear.list.queryOptions({ input: { shootId, limit: 100, includeDeleted: false } }),
  )
  const library = useQuery(
    orpc.gearItems.list.queryOptions({ input: { limit: 200, includeDeleted: false } }),
  )

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: orpc.shootGear.list.key() })
    void queryClient.invalidateQueries({ queryKey: orpc.gearItems.list.key() })
  }

  const add = useMutation(orpc.shootGear.add.mutationOptions({ onSuccess: invalidate }))
  const update = useMutation(orpc.shootGear.update.mutationOptions({ onSuccess: invalidate }))
  const remove = useMutation(orpc.shootGear.remove.mutationOptions({ onSuccess: invalidate }))
  const createItem = useMutation(orpc.gearItems.create.mutationOptions())

  const [selected, setSelected] = useState('')
  const [newName, setNewName] = useState('')
  const [newCategory, setNewCategory] = useState('')

  const items = data?.items ?? []
  const packedCount = items.filter((item) => item.packed).length

  /** Already on this shoot, so the picker does not offer duplicates. */
  const alreadyAdded = new Set(items.map((item) => item.gearItemId))
  const available = (library.data?.items ?? []).filter((item) => !alreadyAdded.has(item.id))

  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-ink-500 text-xs font-medium tracking-wider uppercase">Gear</h2>
        {items.length > 0 && (
          <span className="text-ink-500 text-xs">
            {packedCount} of {items.length} packed
          </span>
        )}
      </div>

      {available.length > 0 && (
        <form
          className="grid gap-2 sm:grid-cols-[1fr_auto]"
          onSubmit={(event) => {
            event.preventDefault()
            if (!selected) return
            add.mutate({ id: newId(), shootId, gearItemId: selected, quantity: 1 })
            setSelected('')
          }}
        >
          <select
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
            aria-label="Gear from library"
            className={controlClass}
          >
            <option value="">Add from your kit…</option>
            {available.map((item) => (
              <option key={item.id} value={item.id}>
                {item.category ? `${item.name} — ${item.category}` : item.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={!hydrated || add.isPending || !selected}
            className="bg-accent-600 hover:bg-accent-500 rounded-lg px-5 py-2.5 font-medium text-white transition-colors disabled:opacity-60"
          >
            Add gear
          </button>
        </form>
      )}

      <form
        className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
        onSubmit={async (event) => {
          event.preventDefault()
          if (!newName.trim()) return

          // New kit joins the library and this shoot in one step, so the
          // library builds itself while planning rather than needing setup
          // up front.
          const item = await createItem.mutateAsync({
            id: newId(),
            name: newName.trim(),
            ...(newCategory.trim() ? { category: newCategory.trim() } : {}),
          })
          add.mutate({ id: newId(), shootId, gearItemId: item.id, quantity: 1 })

          setNewName('')
          setNewCategory('')
        }}
      >
        <input
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          placeholder="Or add new kit"
          aria-label="New gear name"
          className={controlClass}
        />
        <input
          value={newCategory}
          onChange={(event) => setNewCategory(event.target.value)}
          list={categoryListId}
          placeholder="Category (optional)"
          aria-label="New gear category"
          className={controlClass}
        />
        <datalist id={categoryListId}>
          {GEAR_CATEGORY_SUGGESTIONS.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
        <button
          type="submit"
          disabled={!hydrated || createItem.isPending || !newName.trim()}
          className="border-ink-200 dark:border-ink-700 hover:bg-ink-100 dark:hover:bg-ink-900 rounded-lg border px-5 py-2.5 font-medium transition-colors disabled:opacity-60"
        >
          Add new
        </button>
      </form>

      {(add.error ?? createItem.error) && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {(add.error ?? createItem.error)?.message}
        </p>
      )}

      {isPending ? (
        <p className="text-ink-500 text-sm">Loading…</p>
      ) : items.length > 0 ? (
        <ul className="divide-ink-200 dark:divide-ink-800 divide-y">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 py-2.5">
              <input
                type="checkbox"
                checked={item.packed}
                aria-label={`Packed: ${item.name}`}
                onChange={(event) => update.mutate({ id: item.id, packed: event.target.checked })}
                className="accent-accent-600 size-5 rounded"
              />
              <div className="min-w-0 flex-1">
                <p
                  className={`truncate font-medium ${item.packed ? 'text-ink-500 line-through' : ''}`}
                >
                  {item.name}
                  {item.quantity > 1 && ` ×${item.quantity}`}
                </p>
                {item.category && <p className="text-ink-500 mt-0.5 text-xs">{item.category}</p>}
              </div>
              <button
                type="button"
                onClick={() => remove.mutate({ id: item.id })}
                aria-label={`Remove ${item.name}`}
                className="text-ink-500 px-2 py-1.5 text-sm transition-colors hover:text-red-600"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ink-500 text-sm">No gear listed yet.</p>
      )}
    </section>
  )
}

const controlClass =
  'border-ink-200 dark:border-ink-700 dark:bg-ink-900 w-full rounded-lg border bg-white px-3 py-2.5 text-base outline-none focus:border-accent-500'
