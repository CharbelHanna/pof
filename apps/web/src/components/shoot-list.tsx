'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { SHOOT_STATUSES, newId, type ShootStatus } from '@pof/schemas'
import { useState } from 'react'

import { orpc } from '~/lib/api.ts'

/**
 * The Phase 0 end-to-end slice: create, list, rename and soft-delete a shoot.
 *
 * Everything here goes through the oRPC client, which means it travels the
 * same path the Expo app will: procedure → service → withTenant → RLS. No
 * business rules live in this component.
 */
export function ShootList() {
  const queryClient = useQueryClient()
  const listOptions = orpc.shoots.list.queryOptions({
    input: { limit: 50, includeDeleted: false },
  })

  const { data, isPending, error } = useQuery(listOptions)

  const invalidate = () => queryClient.invalidateQueries({ queryKey: orpc.shoots.list.key() })

  const create = useMutation(orpc.shoots.create.mutationOptions({ onSuccess: invalidate }))
  const remove = useMutation(orpc.shoots.delete.mutationOptions({ onSuccess: invalidate }))
  const rename = useMutation(orpc.shoots.update.mutationOptions({ onSuccess: invalidate }))

  const [name, setName] = useState('')
  const [shootTypeKey, setShootTypeKey] = useState('portrait')

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Shoots</h1>
        <p className="text-ink-500 mt-1 text-sm">Everything you are preparing for.</p>
      </section>

      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault()
          if (!name.trim()) return
          create.mutate({
            // Minted client-side so the create is idempotent: a double submit
            // or a replayed offline mutation resolves to the same row rather
            // than a duplicate.
            id: newId(),
            name: name.trim(),
            shootTypeKey,
            status: 'draft',
          })
          setName('')
        }}
      >
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Name your next shoot"
          aria-label="Shoot name"
          className="border-ink-200 dark:border-ink-700 dark:bg-ink-900 focus:border-accent-500 flex-1 rounded-lg border bg-white px-3 py-2.5 text-base outline-none"
        />
        <select
          value={shootTypeKey}
          onChange={(event) => setShootTypeKey(event.target.value)}
          aria-label="Shoot type"
          className="border-ink-200 dark:border-ink-700 dark:bg-ink-900 rounded-lg border bg-white px-3 py-2.5 text-base"
        >
          {/* Phase 1 replaces this with the seeded shoot-type registry, so
              adding a genre becomes an INSERT rather than a code change. */}
          {['portrait', 'editorial', 'landscape', 'product'].map((key) => (
            <option key={key} value={key}>
              {key}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={create.isPending || !name.trim()}
          className="bg-accent-600 hover:bg-accent-500 rounded-lg px-5 py-2.5 font-medium text-white transition-colors disabled:opacity-60"
        >
          Add
        </button>
      </form>

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error.message}
        </p>
      )}

      {isPending ? (
        <p className="text-ink-500 text-sm">Loading…</p>
      ) : data && data.items.length > 0 ? (
        <ul className="divide-ink-200 dark:divide-ink-800 divide-y">
          {data.items.map((shoot) => (
            <li key={shoot.id} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{shoot.name}</p>
                <p className="text-ink-500 mt-0.5 text-xs">
                  {shoot.shootTypeKey} · {shoot.status}
                </p>
              </div>

              <select
                value={shoot.status}
                aria-label={`Status for ${shoot.name}`}
                onChange={(event) =>
                  rename.mutate({ id: shoot.id, status: event.target.value as ShootStatus })
                }
                className="border-ink-200 dark:border-ink-700 dark:bg-ink-900 rounded-md border bg-white px-2 py-1.5 text-sm"
              >
                {SHOOT_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => remove.mutate({ id: shoot.id })}
                aria-label={`Delete ${shoot.name}`}
                className="text-ink-500 px-2 py-1.5 text-sm transition-colors hover:text-red-600"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ink-500 text-sm">No shoots yet. Add your first one above.</p>
      )}
    </div>
  )
}
