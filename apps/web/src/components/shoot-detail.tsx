'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { SHOOT_STATUSES, type ShootStatus } from '@pof/schemas'
import { useState } from 'react'
import Link from 'next/link'

import { DynamicFields } from '~/components/dynamic-fields.tsx'
import { CrewList } from '~/components/crew-list.tsx'
import { GearList } from '~/components/gear-list.tsx'
import { LocationPicker } from '~/components/location-picker.tsx'
import { SessionList } from '~/components/session-list.tsx'
import { orpc } from '~/lib/api.ts'

/**
 * One shoot: its cross-genre fields, its genre-specific fields, and its
 * sessions.
 *
 * The genre fields come entirely from the server's shoot-type list, so this
 * component contains no knowledge of which genres exist or what they ask for.
 */
export function ShootDetail({ shootId }: { shootId: string }) {
  const queryClient = useQueryClient()

  const shootQuery = useQuery(orpc.shoots.get.queryOptions({ input: { id: shootId } }))
  const typesQuery = useQuery(orpc.shootTypes.list.queryOptions({ input: {} }))
  const campaignsQuery = useQuery(
    orpc.campaigns.list.queryOptions({ input: { limit: 100, includeDeleted: false } }),
  )

  const update = useMutation(
    orpc.shoots.update.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: orpc.shoots.get.key() })
        void queryClient.invalidateQueries({ queryKey: orpc.shoots.list.key() })
      },
    }),
  )

  const shoot = shootQuery.data

  /**
   * Genre fields are edited locally and saved explicitly, unlike the selects
   * above which save on change. Typing into a text field should not fire a
   * mutation per keystroke, and a half-typed value is not worth persisting.
   *
   * `null` means "untouched" — the server's values are shown until the user
   * edits something. Mirroring server state into local state with an effect
   * looked simpler, but left the form showing stale values whenever a refetch
   * returned with the same shoot id and genre, since the effect's
   * dependencies had not changed. Deriving it removes the whole class of bug.
   */
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null)
  const details = draft ?? ((shoot?.details ?? {}) as Record<string, unknown>)

  if (shootQuery.isPending) return <p className="text-ink-500 text-sm">Loading…</p>
  if (shootQuery.error)
    return (
      <p role="alert" className="text-sm text-red-600 dark:text-red-400">
        {shootQuery.error.message}
      </p>
    )
  if (!shoot) return null

  const activeType = typesQuery.data?.find((type) => type.key === shoot.shootTypeKey)

  return (
    <div className="space-y-8">
      <div>
        <Link href="/shoots" className="text-ink-500 text-sm hover:underline">
          ← All shoots
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{shoot.name}</h1>
      </div>

      <section className="space-y-4">
        <h2 className="text-ink-500 text-xs font-medium tracking-wider uppercase">Details</h2>

        <Row label="Type">
          <select
            aria-label="Shoot type"
            className={selectClass}
            value={shoot.shootTypeKey}
            onChange={(event) => update.mutate({ id: shoot.id, shootTypeKey: event.target.value })}
          >
            {typesQuery.data?.map((type) => (
              <option key={type.key} value={type.key}>
                {type.label}
              </option>
            ))}
          </select>
        </Row>

        <Row label="Status">
          <select
            aria-label="Status"
            className={selectClass}
            value={shoot.status}
            onChange={(event) =>
              update.mutate({ id: shoot.id, status: event.target.value as ShootStatus })
            }
          >
            {SHOOT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </Row>

        <Row label="Campaign">
          <select
            aria-label="Campaign"
            className={selectClass}
            value={shoot.campaignId ?? ''}
            onChange={(event) =>
              update.mutate({ id: shoot.id, campaignId: event.target.value || null })
            }
          >
            {/* A shoot never has to belong to a campaign. */}
            <option value="">No campaign</option>
            {campaignsQuery.data?.items.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.name}
              </option>
            ))}
          </select>
        </Row>

        <Row label="Location">
          <LocationPicker
            value={shoot.primaryLocationId}
            onChange={(locationId) =>
              update.mutate({ id: shoot.id, primaryLocationId: locationId })
            }
          />
        </Row>

        <Row label="Delivery date">
          <input
            type="date"
            aria-label="Delivery date"
            className={selectClass}
            value={shoot.deliveryDate ?? ''}
            onChange={(event) =>
              update.mutate({ id: shoot.id, deliveryDate: event.target.value || null })
            }
          />
        </Row>
      </section>

      {activeType && activeType.fields.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-ink-500 text-xs font-medium tracking-wider uppercase">
            {activeType.label} details
          </h2>

          <DynamicFields
            fields={activeType.fields}
            values={details}
            onChange={(name, value) =>
              setDraft((previous) => {
                const next = { ...(previous ?? details) }
                // Delete rather than set undefined: the payload is serialised
                // to JSON, where an undefined value simply vanishes and the
                // old stored value would survive the save.
                if (value === undefined) delete next[name]
                else next[name] = value
                return next
              })
            }
            disabled={update.isPending}
          />

          <button
            type="button"
            onClick={() =>
              update.mutate({ id: shoot.id, details }, { onSuccess: () => setDraft(null) })
            }
            disabled={update.isPending}
            className="bg-accent-600 hover:bg-accent-500 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-60"
          >
            {update.isPending ? 'Saving…' : 'Save details'}
          </button>
        </section>
      )}

      {update.error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {update.error.message}
        </p>
      )}

      <SessionList shootId={shoot.id} locationId={shoot.primaryLocationId} />

      <CrewList shootId={shoot.id} />

      <GearList shootId={shoot.id} />
    </div>
  )
}

const selectClass =
  'border-ink-200 dark:border-ink-700 dark:bg-ink-900 w-full rounded-lg border bg-white px-3 py-2 text-base outline-none focus:border-accent-500'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[10rem_1fr] sm:items-center sm:gap-4">
      <span className="text-ink-700 dark:text-ink-300 text-sm font-medium">{label}</span>
      {children}
    </div>
  )
}
