'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CAMPAIGN_STATUSES, type CampaignStatus } from '@pof/schemas'
import Link from 'next/link'

import { ShootList } from '~/components/shoot-list.tsx'
import { orpc } from '~/lib/api.ts'

/**
 * One campaign: its brief and dates, and the shoots inside it.
 *
 * Reuses `ShootList` scoped to this campaign, so creating a shoot from here
 * files it under this campaign automatically and the list behaves identically
 * to the main one. A second, subtly different shoot list would be the obvious
 * way to introduce divergent behaviour.
 */
export function CampaignDetail({ campaignId }: { campaignId: string }) {
  const queryClient = useQueryClient()

  const {
    data: campaign,
    isPending,
    error,
  } = useQuery(orpc.campaigns.get.queryOptions({ input: { id: campaignId } }))

  const update = useMutation(
    orpc.campaigns.update.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: orpc.campaigns.get.key() })
        void queryClient.invalidateQueries({ queryKey: orpc.campaigns.list.key() })
      },
    }),
  )

  if (isPending) return <p className="text-ink-500 text-sm">Loading…</p>
  if (error)
    return (
      <p role="alert" className="text-sm text-red-600 dark:text-red-400">
        {error.message}
      </p>
    )
  if (!campaign) return null

  return (
    <div className="space-y-8">
      <div>
        <Link href="/campaigns" className="text-ink-500 text-sm hover:underline">
          ← All campaigns
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{campaign.name}</h1>
      </div>

      <section className="space-y-4">
        <h2 className="text-ink-500 text-xs font-medium tracking-wider uppercase">Details</h2>

        <Row label="Status">
          <select
            aria-label="Campaign status"
            className={controlClass}
            value={campaign.status}
            onChange={(event) =>
              update.mutate({ id: campaign.id, status: event.target.value as CampaignStatus })
            }
          >
            {CAMPAIGN_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </Row>

        <Row label="Runs from">
          <input
            type="date"
            aria-label="Campaign start date"
            className={controlClass}
            value={campaign.startsOn ?? ''}
            onChange={(event) =>
              update.mutate({ id: campaign.id, startsOn: event.target.value || null })
            }
          />
        </Row>

        <Row label="Runs until">
          <input
            type="date"
            aria-label="Campaign end date"
            className={controlClass}
            value={campaign.endsOn ?? ''}
            onChange={(event) =>
              update.mutate({ id: campaign.id, endsOn: event.target.value || null })
            }
          />
        </Row>

        <Row label="Brief">
          <textarea
            rows={3}
            aria-label="Campaign brief"
            className={controlClass}
            placeholder="What the client asked for, in their words."
            defaultValue={campaign.brief ?? ''}
            // Saved on blur rather than per keystroke: a brief is a paragraph,
            // and a mutation per character would be absurd.
            onBlur={(event) =>
              event.target.value !== (campaign.brief ?? '') &&
              update.mutate({ id: campaign.id, brief: event.target.value || null })
            }
          />
        </Row>

        {update.error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {update.error.message}
          </p>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-ink-500 text-xs font-medium tracking-wider uppercase">
          Shoots in this campaign
        </h2>
        <ShootList campaignId={campaign.id} />
      </section>
    </div>
  )
}

const controlClass =
  'border-ink-200 dark:border-ink-700 dark:bg-ink-900 w-full rounded-lg border bg-white px-3 py-2 text-base outline-none focus:border-accent-500'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[10rem_1fr] sm:items-start sm:gap-4">
      <span className="text-ink-700 dark:text-ink-300 pt-2 text-sm font-medium">{label}</span>
      {children}
    </div>
  )
}
