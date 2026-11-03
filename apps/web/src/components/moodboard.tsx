'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { newId } from '@pof/schemas'
import { useEffect, useRef, useState } from 'react'

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
  const reorder = useMutation(orpc.moodboards.reorder.mutationOptions({ onSuccess: invalidate }))

  /** Arrangement is the point of a board, so render in position order. */
  const serverOrder = [...(items.data?.items ?? [])].sort((a, b) => a.position - b.position)

  /**
   * While dragging, the grid follows a local order so tiles move under the
   * finger rather than after a round trip. Null means "defer to the server",
   * which is restored once the save lands and the list refetches.
   */
  const [dragOrder, setDragOrder] = useState<string[] | null>(null)
  /**
   * State rather than a ref: the dragged tile dims while it moves, and a ref
   * change does not re-render, so the one visual cue that a drag is in
   * progress would never appear.
   */
  const [draggingId, setDraggingId] = useState<string | null>(null)

  useEffect(() => {
    // A removal or an upload changes the set, so a stale local order would
    // drop or duplicate a tile. Server order wins whenever it changes.
    setDragOrder(null)
  }, [items.dataUpdatedAt])

  const sorted = dragOrder
    ? dragOrder
        .map((id) => serverOrder.find((item) => item.id === id))
        .filter((item): item is (typeof serverOrder)[number] => item !== undefined)
    : serverOrder

  /** Move an item to a new index, by id, without mutating state in place. */
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
   * One call with the full order, not a patch per tile: moving one image
   * changes the position of every image it passed, and the endpoint rejects
   * a partial list for exactly that reason.
   */
  function commit(ids: string[]) {
    if (!board) return
    const unchanged = ids.every((id, index) => serverOrder[index]?.id === id)
    if (unchanged) return
    reorder.mutate({ moodboardId: board.id, orderedIds: ids })
  }

  function moveBy(id: string, delta: number) {
    const ids = sorted.map((item) => item.id)
    const next = reposition(ids, id, ids.indexOf(id) + delta)
    if (next === ids) return
    setDragOrder(next)
    commit(next)
  }

  /**
   * The board id, once anything knows it.
   *
   * A ref rather than the query result, because `handleUploaded` runs from
   * the closure of whichever render began the batch — and that closure's
   * `board` stays undefined for the whole batch, however many refetches
   * happen meanwhile. Reading the query variable there is what made two
   * files create two boards: the first created one, the second still saw
   * nothing and created another, and only the first is rendered, so the
   * second image silently vanished.
   *
   * Refs are stable across renders, so this is the one value the batch can
   * agree on.
   */
  const knownBoardId = useRef<string | null>(null)
  /** The in-flight creation, so concurrent callers await one request. */
  const boardCreation = useRef<Promise<string> | null>(null)

  useEffect(() => {
    if (board) knownBoardId.current = board.id
  }, [board])

  async function ensureBoard(): Promise<string> {
    if (knownBoardId.current) return knownBoardId.current

    /**
     * The board is created on first upload rather than up front, so a shoot
     * with no references carries no empty row and the section can stay out
     * of the way until it is wanted.
     */
    boardCreation.current ??= createBoard
      .mutateAsync({ id: newId(), shootId, name: 'References' })
      .then((created) => {
        knownBoardId.current = created.id
        return created.id
      })
      .catch((error: unknown) => {
        // Never cache a rejection, or every later upload in the session
        // fails for a reason that has already passed.
        boardCreation.current = null
        throw error
      })

    return boardCreation.current
  }

  async function handleUploaded(assetId: string) {
    const moodboardId = await ensureBoard()
    await addItem.mutateAsync({ id: newId(), moodboardId, assetId })
  }

  return (
    <section aria-labelledby="moodboard-heading" className="space-y-3">
      <h2 id="moodboard-heading" className="text-lg font-semibold">
        References
      </h2>

      <ImageUpload onUploaded={handleUploaded} label="Add references" />

      {sorted.length > 0 && (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {sorted.map((item, index) => (
            <li
              key={item.id}
              data-item-id={item.id}
              className={[
                'relative transition-opacity',
                draggingId === item.id ? 'opacity-40' : '',
              ].join(' ')}
            >
              <button
                type="button"
                onClick={() => setLightbox(item.assetId)}
                aria-label="Open reference"
                className="border-ink-200 dark:border-ink-700 block w-full overflow-hidden rounded-lg border"
              >
                <AssetImage assetId={item.assetId} variant="thumb" className="aspect-square" />
              </button>

              {/*
                A dedicated handle rather than dragging the whole tile.
                `touch-action: none` is required for a pointer drag to beat
                the browser's scrolling, and applying that to the tile would
                make the grid unscrollable on a phone — where these boards
                are mostly opened. Confining it to the handle keeps the rest
                of the tile scrollable and tappable.
              */}
              <button
                type="button"
                aria-label={`Reorder reference ${index + 1} of ${sorted.length}`}
                onPointerDown={(event) => {
                  event.preventDefault()
                  setDraggingId(item.id)
                  event.currentTarget.setPointerCapture(event.pointerId)
                  setDragOrder(sorted.map((i) => i.id))
                }}
                onPointerMove={(event) => {
                  if (draggingId !== item.id) return

                  /*
                   * Hit-test what is under the pointer rather than tracking
                   * geometry ourselves. The grid reflows at two breakpoints
                   * and tiles are square-but-fluid, so computed positions
                   * would be wrong on the first resize.
                   */
                  const under = document
                    .elementFromPoint(event.clientX, event.clientY)
                    ?.closest('[data-item-id]')
                  const overId = under?.getAttribute('data-item-id')
                  if (!overId || overId === item.id) return

                  setDragOrder((current) => {
                    const ids = current ?? sorted.map((i) => i.id)
                    return reposition(ids, item.id, ids.indexOf(overId))
                  })
                }}
                onPointerUp={() => {
                  if (draggingId !== item.id) return
                  setDraggingId(null)
                  commit(sorted.map((i) => i.id))
                }}
                onPointerCancel={() => {
                  // A cancelled gesture must not leave a half-applied order.
                  setDraggingId(null)
                  setDragOrder(null)
                }}
                onKeyDown={(event) => {
                  /*
                   * Dragging is unreachable by keyboard, so the same handle
                   * moves the tile with the arrow keys. Without this the
                   * arrangement — the entire point of a moodboard — would
                   * be mouse-and-touch only.
                   */
                  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                    event.preventDefault()
                    moveBy(item.id, -1)
                  } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                    event.preventDefault()
                    moveBy(item.id, 1)
                  }
                }}
                className="bg-ink-950/70 absolute top-1 left-1 cursor-grab touch-none rounded px-1.5 py-0.5 text-xs text-white active:cursor-grabbing"
              >
                Drag
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

      {reorder.error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          Could not save the new order. {reorder.error.message}
        </p>
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
