'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { newId } from '@pof/schemas'
import { useState } from 'react'

import { ImageUpload } from '~/components/image-upload.tsx'
import { orpc } from '~/lib/api.ts'

/**
 * A moodboard: references, arranged.
 *
 * One board per shoot for now. The schema allows several — a board is a row
 * with a name — but a second board is a navigation problem, and nobody has
 * asked for one yet.
 */
export function Moodboard({ shootId }: { shootId: string }) {
  const queryClient = useQueryClient()
  const [lightbox, setLightbox] = useState<string | null>(null)

  const boards = useQuery(
    orpc.moodboards.list.queryOptions({ input: { shootId, limit: 10, includeDeleted: false } }),
  )
  const board = boards.data?.items[0]

  const items = useQuery({
    ...orpc.moodboards.listItems.queryOptions({
      input: { moodboardId: board?.id ?? '', limit: 500, includeDeleted: false },
    }),
    // Skip entirely until a board exists, rather than querying for ''.
    enabled: Boolean(board?.id),
  })

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: orpc.moodboards.list.key() })
    void queryClient.invalidateQueries({ queryKey: orpc.moodboards.listItems.key() })
  }

  const createBoard = useMutation(orpc.moodboards.create.mutationOptions({ onSuccess: invalidate }))
  const addItem = useMutation(orpc.moodboards.addItem.mutationOptions({ onSuccess: invalidate }))
  const removeItem = useMutation(
    orpc.moodboards.removeItem.mutationOptions({ onSuccess: invalidate }),
  )

  /** Arrangement is the point of a board, so render in position order. */
  const sorted = [...(items.data?.items ?? [])].sort((a, b) => a.position - b.position)

  async function handleUploaded(assetId: string) {
    /**
     * The board is created on first upload rather than up front, so a shoot
     * with no references carries no empty row and the section can stay out
     * of the way until it is wanted.
     */
    const target =
      board ?? (await createBoard.mutateAsync({ id: newId(), shootId, name: 'References' }))

    await addItem.mutateAsync({ id: newId(), moodboardId: target.id, assetId })
  }

  return (
    <section aria-labelledby="moodboard-heading" className="space-y-3">
      <h2 id="moodboard-heading" className="text-lg font-semibold">
        References
      </h2>

      <ImageUpload onUploaded={handleUploaded} label="Add references" />

      {sorted.length > 0 && (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {sorted.map((item) => (
            <li key={item.id} className="group relative">
              <button
                type="button"
                onClick={() => setLightbox(item.assetId)}
                aria-label="Open reference"
                className="border-ink-200 dark:border-ink-700 block w-full overflow-hidden rounded-lg border"
              >
                <AssetImage assetId={item.assetId} variant="thumb" className="aspect-square" />
              </button>

              <button
                type="button"
                onClick={() => removeItem.mutate({ id: item.id })}
                aria-label="Remove reference"
                /**
                 * Always present rather than hover-only: a hover-revealed
                 * control is unreachable on a phone, which is where these
                 * boards are most often opened.
                 */
                className="bg-ink-950/70 absolute top-1 right-1 rounded px-1.5 py-0.5 text-xs text-white transition-colors hover:bg-red-600"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {lightbox && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Reference"
          onClick={() => setLightbox(null)}
          className="bg-ink-950/90 fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <AssetImage assetId={lightbox} variant="full" className="max-h-full max-w-full" />
          <button
            type="button"
            onClick={() => setLightbox(null)}
            aria-label="Close"
            className="absolute top-4 right-4 rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white"
          >
            Close
          </button>
        </div>
      )}
    </section>
  )
}

/**
 * One image, fetched through a short-lived signed URL.
 *
 * Objects are private — row-level security does not reach into a bucket, so
 * the bytes are only ever served behind a URL that expires. That means a
 * round trip per image rather than a plain `src`, which is the cost of not
 * making the bucket public.
 */
function AssetImage({
  assetId,
  variant,
  className,
}: {
  assetId: string
  variant: 'thumb' | 'grid' | 'full'
  className?: string
}) {
  const url = useQuery({
    ...orpc.assets.readUrl.queryOptions({ input: { id: assetId, variant, format: 'webp' } }),
    /**
     * Shorter than the URL's own lifetime, so a cached entry is never
     * handed out after it has expired.
     */
    staleTime: 4 * 60 * 1000,
  })

  if (!url.data) {
    return <div className={`bg-ink-100 dark:bg-ink-900 ${className ?? ''}`} aria-hidden="true" />
  }

  return (
    // Plain <img>: next/image is configured `unoptimized` because this app
    // renders its own derivatives, so the component would add nothing but a
    // wrapper.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url.data.url} alt="" loading="lazy" className={`object-cover ${className ?? ''}`} />
  )
}
