'use client'

import { ALLOWED_IMAGE_MIME, MAX_ASSET_BYTES, newId } from '@pof/schemas'
import { useRef, useState } from 'react'

import { orpc } from '~/lib/api.ts'
import { useHydrated } from '~/lib/use-hydrated.ts'

/**
 * Pick files and send them straight to storage.
 *
 * The bytes never pass through our server: the API hands back a described
 * request, the browser PUTs to it, and only then does the server hear that
 * it happened. That is what keeps a 40MB raw file out of a request handler —
 * and it is why this component owns a small state machine rather than just
 * posting a form.
 *
 * Each file is tracked independently. Uploading eight references and having
 * one fail should leave seven uploaded and one reported, not an all-or-
 * nothing error.
 */

type UploadState = 'uploading' | 'processing' | 'done' | 'failed'

interface Upload {
  /** Client-minted, so a retry of the same file is idempotent server-side. */
  id: string
  filename: string
  state: UploadState
  error?: string
}

export function ImageUpload({
  onUploaded,
  label = 'Add images',
}: {
  /** Called per file once the server has confirmed the bytes landed. */
  onUploaded: (assetId: string) => void | Promise<void>
  label?: string
}) {
  const hydrated = useHydrated()
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploads, setUploads] = useState<Upload[]>([])
  const [dragging, setDragging] = useState(false)

  const createUpload = orpc.assets.createUpload
  const confirmUpload = orpc.assets.confirmUpload

  function patch(id: string, change: Partial<Upload>) {
    setUploads((current) => current.map((u) => (u.id === id ? { ...u, ...change } : u)))
  }

  async function uploadOne(file: File) {
    const id = newId()

    /**
     * Checked here as well as on the server. The server is the authority —
     * it reads the real size back from storage — but finding out after a
     * 50MB upload that it was too big is a poor way to learn it.
     */
    if (!ALLOWED_IMAGE_MIME.includes(file.type as (typeof ALLOWED_IMAGE_MIME)[number])) {
      setUploads((c) => [
        ...c,
        { id, filename: file.name, state: 'failed', error: 'That file type is not supported' },
      ])
      return
    }

    if (file.size > MAX_ASSET_BYTES) {
      setUploads((c) => [
        ...c,
        { id, filename: file.name, state: 'failed', error: 'That file is larger than 50MB' },
      ])
      return
    }

    setUploads((c) => [...c, { id, filename: file.name, state: 'uploading' }])

    try {
      const { asset, target } = await createUpload.call({
        id,
        mime: file.type as (typeof ALLOWED_IMAGE_MIME)[number],
        filename: file.name,
        bytes: file.size,
      })

      /**
       * The headers come from the server and must be sent verbatim — the
       * content type is part of the signature, so changing it invalidates
       * the whole request.
       */
      const response = await fetch(target.url, {
        method: target.method,
        headers: target.headers,
        body: file,
      })

      if (!response.ok) {
        throw new Error(`Storage rejected the upload (${response.status})`)
      }

      await confirmUpload.call({ id: asset.id })

      /**
       * `processing`, not `done`: the bytes are stored, but derivatives are
       * rendered by the worker afterwards. Saying "done" here would promise
       * a thumbnail that does not exist yet.
       */
      patch(id, { state: 'processing' })
      await onUploaded(asset.id)
      patch(id, { state: 'done' })
    } catch (error) {
      patch(id, {
        state: 'failed',
        error: error instanceof Error ? error.message : 'Upload failed',
      })
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files) return
    // Sequential rather than parallel: a phone on mobile data uploading six
    // files at once is slower overall and far more likely to drop one.
    for (const file of Array.from(files)) {
      await uploadOne(file)
    }
  }

  const pending = uploads.filter((u) => u.state === 'uploading' || u.state === 'processing')
  const failed = uploads.filter((u) => u.state === 'failed')

  return (
    <div className="space-y-2">
      <div
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          void handleFiles(event.dataTransfer.files)
        }}
        className={[
          'rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors',
          dragging ? 'border-accent-500 bg-accent-500/10' : 'border-ink-200 dark:border-ink-700',
        ].join(' ')}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          // `capture` is deliberately absent: offering the camera roll AND
          // the camera is what a photographer wants, and `capture` forces
          // the camera only.
          accept={ALLOWED_IMAGE_MIME.join(',')}
          aria-label={label}
          onChange={(event) => {
            void handleFiles(event.target.files)
            // Lets the same file be chosen again after a failure.
            event.target.value = ''
          }}
          className="sr-only"
        />

        <button
          type="button"
          // Pre-hydration a click would do nothing, so the control says so
          // rather than silently ignoring the first tap.
          disabled={!hydrated}
          onClick={() => inputRef.current?.click()}
          className="bg-accent-600 hover:bg-accent-500 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-60"
        >
          {label}
        </button>

        <p className="text-ink-500 mt-2 text-xs">or drop them here · JPEG, PNG, WebP, HEIC</p>
      </div>

      {pending.length > 0 && (
        <ul className="space-y-1" aria-live="polite">
          {pending.map((upload) => (
            <li key={upload.id} className="text-ink-700 dark:text-ink-300 truncate text-xs">
              {upload.filename} — {upload.state === 'uploading' ? 'uploading…' : 'processing…'}
            </li>
          ))}
        </ul>
      )}

      {failed.length > 0 && (
        <ul className="space-y-1" role="alert">
          {failed.map((upload) => (
            <li key={upload.id} className="truncate text-xs text-red-600 dark:text-red-400">
              {upload.filename} — {upload.error}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
