'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CAMPAIGN_STATUSES, newId, type CampaignStatus } from '@pof/schemas'
import Link from 'next/link'
import { useState } from 'react'

import { orpc } from '~/lib/api.ts'
import { useHydrated } from '~/lib/use-hydrated.ts'

/**
 * Campaigns — an optional grouping of shoots.
 *
 * Deliberately sparse. A campaign exists to hold shoots together and carry a
 * brief; everything that actually gets planned lives on the shoot.
 */
export function CampaignList() {
  const queryClient = useQueryClient()
  const input = { limit: 100, includeDeleted: false }

  const { data, isPending, error } = useQuery(orpc.campaigns.list.queryOptions({ input }))

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: orpc.campaigns.list.key() })

  const create = useMutation(orpc.campaigns.create.mutationOptions({ onSuccess: invalidate }))
  const update = useMutation(orpc.campaigns.update.mutationOptions({ onSuccess: invalidate }))
  const remove = useMutation(orpc.campaigns.delete.mutationOptions({ onSuccess: invalidate }))

  const hydrated = useHydrated()
  const [name, setName] = useState('')

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
        <p className="text-ink-500 mt-1 text-sm">
          Group related shoots. Optional — a one-off shoot needs no campaign.
        </p>
      </section>

      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault()
          if (!name.trim()) return
          create.mutate({ id: newId(), name: name.trim(), status: 'draft' })
          setName('')
        }}
      >
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Name a campaign"
          aria-label="Campaign name"
          className="border-ink-200 dark:border-ink-700 dark:bg-ink-900 focus:border-accent-500 flex-1 rounded-lg border bg-white px-3 py-2.5 text-base outline-none"
        />
        <button
          type="submit"
          disabled={!hydrated || create.isPending || !name.trim()}
          className="bg-accent-600 hover:bg-accent-500 rounded-lg px-5 py-2.5 font-medium text-white transition-colors disabled:opacity-60"
        >
          Add
        </button>
      </form>

      {(error ?? create.error) && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {(error ?? create.error)?.message}
        </p>
      )}

      {isPending ? (
        <p className="text-ink-500 text-sm">Loading…</p>
      ) : data && data.items.length > 0 ? (
        <ul className="divide-ink-200 dark:divide-ink-800 divide-y">
          {data.items.map((campaign) => (
            <li key={campaign.id} className="flex items-center gap-3 py-3">
              <Link
                href={`/campaigns/${campaign.id}`}
                className="min-w-0 flex-1 transition-opacity hover:opacity-70"
              >
                <p className="truncate font-medium">{campaign.name}</p>
                <p className="text-ink-500 mt-0.5 text-xs">
                  {campaign.startsOn && campaign.endsOn
                    ? `${campaign.startsOn} → ${campaign.endsOn}`
                    : 'No dates set'}
                </p>
              </Link>

              <select
                value={campaign.status}
                aria-label={`Status for ${campaign.name}`}
                onChange={(event) =>
                  update.mutate({
                    id: campaign.id,
                    status: event.target.value as CampaignStatus,
                  })
                }
                className="border-ink-200 dark:border-ink-700 dark:bg-ink-900 rounded-md border bg-white px-2 py-1.5 text-sm"
              >
                {CAMPAIGN_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => remove.mutate({ id: campaign.id })}
                aria-label={`Delete ${campaign.name}`}
                className="text-ink-500 px-2 py-1.5 text-sm transition-colors hover:text-red-600"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ink-500 text-sm">No campaigns yet.</p>
      )}

      <p className="text-ink-500 text-xs">
        Deleting a campaign keeps its shoots — they simply stop being grouped.
      </p>
    </div>
  )
}
