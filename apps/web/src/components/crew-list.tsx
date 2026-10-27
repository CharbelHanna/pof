'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CREW_ROLE_SUGGESTIONS, newId } from '@pof/schemas'
import { useId, useState } from 'react'

import { orpc } from '~/lib/api.ts'
import { useHydrated } from '~/lib/use-hydrated.ts'

/**
 * Who is working this shoot.
 *
 * Role is required, name optional — a shoot is planned around "an assistant"
 * long before anyone is booked, and forcing a name would mean inventing
 * placeholder people.
 */
export function CrewList({ shootId }: { shootId: string }) {
  const queryClient = useQueryClient()
  const hydrated = useHydrated()
  const roleListId = useId()

  const input = { shootId, limit: 100, includeDeleted: false }
  const { data, isPending } = useQuery(orpc.crew.list.queryOptions({ input }))

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: orpc.crew.list.key() })
  const create = useMutation(orpc.crew.create.mutationOptions({ onSuccess: invalidate }))
  const remove = useMutation(orpc.crew.delete.mutationOptions({ onSuccess: invalidate }))

  const [role, setRole] = useState('')
  const [name, setName] = useState('')

  const members = data?.items ?? []

  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-ink-500 text-xs font-medium tracking-wider uppercase">Crew</h2>
        {members.length > 0 && (
          <span className="text-ink-500 text-xs">
            {members.length} {members.length === 1 ? 'person' : 'people'}
          </span>
        )}
      </div>

      <form
        className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
        onSubmit={(event) => {
          event.preventDefault()
          if (!role.trim()) return
          create.mutate({
            id: newId(),
            shootId,
            role: role.trim(),
            ...(name.trim() ? { name: name.trim() } : {}),
          })
          setRole('')
          setName('')
        }}
      >
        <input
          value={role}
          onChange={(event) => setRole(event.target.value)}
          list={roleListId}
          placeholder="Role"
          aria-label="Crew role"
          className={controlClass}
        />
        {/* Suggestions, not a constraint — crews invent roles. */}
        <datalist id={roleListId}>
          {CREW_ROLE_SUGGESTIONS.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>

        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Name (optional)"
          aria-label="Crew name"
          className={controlClass}
        />

        <button
          type="submit"
          disabled={!hydrated || create.isPending || !role.trim()}
          className="bg-accent-600 hover:bg-accent-500 rounded-lg px-5 py-2.5 font-medium text-white transition-colors disabled:opacity-60"
        >
          Add crew
        </button>
      </form>

      {create.error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {create.error.message}
        </p>
      )}

      {isPending ? (
        <p className="text-ink-500 text-sm">Loading…</p>
      ) : members.length > 0 ? (
        <ul className="divide-ink-200 dark:divide-ink-800 divide-y">
          {members.map((member) => (
            <li key={member.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{member.name ?? member.role}</p>
                {member.name && <p className="text-ink-500 mt-0.5 text-xs">{member.role}</p>}
              </div>
              <button
                type="button"
                onClick={() => remove.mutate({ id: member.id })}
                aria-label={`Remove ${member.name ?? member.role}`}
                className="text-ink-500 px-2 py-1.5 text-sm transition-colors hover:text-red-600"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ink-500 text-sm">No crew yet. Add a role above.</p>
      )}
    </section>
  )
}

const controlClass =
  'border-ink-200 dark:border-ink-700 dark:bg-ink-900 w-full rounded-lg border bg-white px-3 py-2.5 text-base outline-none focus:border-accent-500'
