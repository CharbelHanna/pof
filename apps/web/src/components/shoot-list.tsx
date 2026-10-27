'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { SHOOT_STATUSES, newId, type ShootStatus } from '@pof/schemas'
import Link from 'next/link'
import { useState } from 'react'

import { orpc } from '~/lib/api.ts'
import { useHydrated } from '~/lib/use-hydrated.ts'

/**
 * The shoot list.
 *
 * Shows which campaign each shoot belongs to, and can be filtered by one.
 * Without that, campaign membership was only visible by opening each shoot in
 * turn — which made the grouping effectively invisible and the feature
 * pointless from here.
 */
export function ShootList({ campaignId }: { campaignId?: string } = {}) {
  const queryClient = useQueryClient()

  // When rendered inside a campaign the filter is fixed and its control is
  // hidden; the surrounding page has already said which campaign this is.
  const [filter, setFilter] = useState<string>(campaignId ?? '')
  const activeFilter = campaignId ?? filter

  const listInput = {
    limit: 50,
    includeDeleted: false,
    ...(activeFilter ? { campaignId: activeFilter as string } : {}),
  }

  const { data, isPending, error } = useQuery(orpc.shoots.list.queryOptions({ input: listInput }))
  const campaignsQuery = useQuery(
    orpc.campaigns.list.queryOptions({ input: { limit: 100, includeDeleted: false } }),
  )

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: orpc.shoots.list.key() })

  const create = useMutation(orpc.shoots.create.mutationOptions({ onSuccess: invalidate }))
  const remove = useMutation(orpc.shoots.delete.mutationOptions({ onSuccess: invalidate }))
  const update = useMutation(orpc.shoots.update.mutationOptions({ onSuccess: invalidate }))

  const hydrated = useHydrated()
  const [name, setName] = useState('')
  const [shootTypeKey, setShootTypeKey] = useState('portrait')
  const [newCampaignId, setNewCampaignId] = useState(campaignId ?? '')

  const campaignName = (id: string | null) =>
    id ? campaignsQuery.data?.items.find((c) => c.id === id)?.name : undefined

  return (
    <div className="space-y-6">
      {!campaignId && (
        <section>
          <h1 className="text-2xl font-semibold tracking-tight">Shoots</h1>
          <p className="text-ink-500 mt-1 text-sm">Everything you are preparing for.</p>
        </section>
      )}

      <form
        className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]"
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
            ...(newCampaignId ? { campaignId: newCampaignId } : {}),
          })
          setName('')
        }}
      >
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Name your next shoot"
          aria-label="Shoot name"
          className={controlClass}
        />
        <select
          value={shootTypeKey}
          onChange={(event) => setShootTypeKey(event.target.value)}
          aria-label="Shoot type"
          className={controlClass}
        >
          {/* Phase 1 replaces this with the seeded shoot-type registry, so
              adding a genre becomes an INSERT rather than a code change. */}
          {['portrait', 'editorial', 'landscape', 'product'].map((key) => (
            <option key={key} value={key}>
              {key}
            </option>
          ))}
        </select>

        {/* Assigning a campaign at creation, not only afterwards on the
            detail page — grouping a shoot is part of planning it. */}
        {!campaignId && (
          <select
            value={newCampaignId}
            onChange={(event) => setNewCampaignId(event.target.value)}
            aria-label="Campaign for new shoot"
            className={controlClass}
          >
            <option value="">No campaign</option>
            {campaignsQuery.data?.items.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.name}
              </option>
            ))}
          </select>
        )}

        <button
          type="submit"
          disabled={!hydrated || create.isPending || !name.trim()}
          className="bg-accent-600 hover:bg-accent-500 rounded-lg px-5 py-2.5 font-medium text-white transition-colors disabled:opacity-60"
        >
          Add
        </button>
      </form>

      {!campaignId && (campaignsQuery.data?.items.length ?? 0) > 0 && (
        <label className="flex items-center gap-2">
          <span className="text-ink-500 text-sm">Show</span>
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            aria-label="Filter by campaign"
            className="border-ink-200 dark:border-ink-700 dark:bg-ink-900 focus:border-accent-500 rounded-lg border bg-white px-3 py-1.5 text-sm outline-none"
          >
            <option value="">All shoots</option>
            <option value="none">Not in a campaign</option>
            {campaignsQuery.data?.items.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {(error ?? create.error) && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {(error ?? create.error)?.message}
        </p>
      )}

      {isPending ? (
        <p className="text-ink-500 text-sm">Loading…</p>
      ) : data && data.items.length > 0 ? (
        <ul className="divide-ink-200 dark:divide-ink-800 divide-y">
          {data.items.map((shoot) => (
            <li key={shoot.id} className="flex items-center gap-3 py-3">
              <Link
                href={`/shoots/${shoot.id}`}
                className="min-w-0 flex-1 transition-opacity hover:opacity-70"
              >
                <p className="truncate font-medium">{shoot.name}</p>
                <p className="text-ink-500 mt-0.5 text-xs">
                  {shoot.shootTypeKey} · {shoot.status}
                  {campaignName(shoot.campaignId) && <> · {campaignName(shoot.campaignId)}</>}
                </p>
              </Link>

              <select
                value={shoot.status}
                aria-label={`Status for ${shoot.name}`}
                onChange={(event) =>
                  update.mutate({ id: shoot.id, status: event.target.value as ShootStatus })
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
        <p className="text-ink-500 text-sm">
          {activeFilter
            ? 'No shoots match this filter.'
            : 'No shoots yet. Add your first one above.'}
        </p>
      )}
    </div>
  )
}

const controlClass =
  'border-ink-200 dark:border-ink-700 dark:bg-ink-900 w-full rounded-lg border bg-white px-3 py-2.5 text-base outline-none focus:border-accent-500'
