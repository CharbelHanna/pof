import { createDatabase, type Database } from '@pof/db'
import { testDatabaseUrls } from '@pof/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createS3Storage } from '../../adapters/s3-storage.ts'
import { NotFoundError, ValidationError } from '../../errors.ts'
import type { StoragePort } from '../../ports/storage.ts'
import { newWorkspace } from '../../testing/fixtures.ts'
import { testStorage } from '../../testing/storage.ts'
import * as assets from './asset.service.ts'

/**
 * The upload lifecycle, against a real database and real storage.
 *
 * The interesting states here are the ones between the steps — a row with no
 * object behind it, an object larger than it claimed, a confirm that arrives
 * twice — and those only exist because the bytes go straight to the bucket.
 * A mocked store would answer every one of them the way the code expects
 * rather than the way a provider does.
 */

let db: Database
let close: () => Promise<void>

const storage: StoragePort = createS3Storage({
  ...testStorage(),
  region: 'auto',
  forcePathStyle: true,
})

beforeAll(async () => {
  const created = createDatabase(testDatabaseUrls().appUrl, { max: 5 })
  db = created.db
  close = async () => {
    await created.client.end({ timeout: 5 })
  }
})

afterAll(async () => {
  await close?.()
})

const ws = () => newWorkspace(db)

/** Four bytes of JPEG magic — enough to be a real object. */
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])

/** Walk an asset through all three steps. */
async function uploadFully(ctx: Awaited<ReturnType<typeof ws>>) {
  const { asset, target } = await assets.createUpload(db, ctx, storage, {
    mime: 'image/jpeg',
    filename: 'frame.jpg',
  })

  const response = await fetch(target.url, {
    method: target.method,
    headers: target.headers,
    body: JPEG,
  })
  expect(response.ok).toBe(true)

  return assets.confirmUpload(db, ctx, storage, { id: asset.id })
}

describe('createUpload', () => {
  it('writes a pending row and returns a usable target', async () => {
    const ctx = await ws()

    const { asset, target } = await assets.createUpload(db, ctx, storage, {
      mime: 'image/jpeg',
      filename: 'frame.jpg',
    })

    expect(asset.status).toBe('pending')
    expect(asset.workspaceId).toBe(ctx.workspaceId)
    expect(target.expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('puts the workspace in the key', async () => {
    const ctx = await ws()

    const { asset } = await assets.createUpload(db, ctx, storage, { mime: 'image/jpeg' })

    // Row-level security does not reach into a bucket, so the key is what
    // keeps one workspace's objects from being guessable from another's.
    expect(asset.storageKey).toBe(`w/${ctx.workspaceId}/a/${asset.id}/original.jpg`)
  })

  it('is idempotent when the same client id is replayed', async () => {
    const ctx = await ws()
    const id = crypto.randomUUID()

    const first = await assets.createUpload(db, ctx, storage, { id, mime: 'image/jpeg' })
    const second = await assets.createUpload(db, ctx, storage, { id, mime: 'image/jpeg' })

    // A resumed upload asks again for the same asset; it must not orphan the
    // first row or issue a target for a different key.
    expect(second.asset.id).toBe(first.asset.id)
    expect(second.asset.storageKey).toBe(first.asset.storageKey)
  })
})

describe('confirmUpload', () => {
  it('flips to uploaded and records the real size', async () => {
    const ctx = await ws()

    const confirmed = await uploadFully(ctx)

    expect(confirmed.status).toBe('uploaded')
    // Read back from the provider, not taken from the client.
    expect(confirmed.bytes).toBe(JPEG.byteLength)
    expect(confirmed.uploadedAt).not.toBeNull()
  })

  it('refuses to confirm bytes that were never sent', async () => {
    const ctx = await ws()
    const { asset } = await assets.createUpload(db, ctx, storage, { mime: 'image/jpeg' })

    // The whole point of asking storage: a client claiming success for an
    // upload it abandoned would otherwise queue processing against nothing.
    await expect(assets.confirmUpload(db, ctx, storage, { id: asset.id })).rejects.toThrow(
      ValidationError,
    )
  })

  it('ignores a size the client claimed and uses the real one', async () => {
    const ctx = await ws()

    const { asset, target } = await assets.createUpload(db, ctx, storage, {
      mime: 'image/jpeg',
      bytes: 1, // a lie
    })
    await fetch(target.url, { method: target.method, headers: target.headers, body: JPEG })

    const confirmed = await assets.confirmUpload(db, ctx, storage, { id: asset.id })

    expect(confirmed.bytes).toBe(JPEG.byteLength)
  })

  it('is safe to call twice', async () => {
    const ctx = await ws()
    const confirmed = await uploadFully(ctx)

    // A retried request, or two tabs. Neither should re-read storage or
    // move the row backwards.
    const again = await assets.confirmUpload(db, ctx, storage, { id: confirmed.id })
    expect(again.status).toBe('uploaded')
    expect(again.uploadedAt?.getTime()).toBe(confirmed.uploadedAt?.getTime())
  })

  it('cannot confirm another workspace’s asset', async () => {
    const ctx = await ws()
    const stranger = await ws()
    const { asset } = await assets.createUpload(db, ctx, storage, { mime: 'image/jpeg' })

    await expect(assets.confirmUpload(db, stranger, storage, { id: asset.id })).rejects.toThrow(
      NotFoundError,
    )
  })
})

describe('createReadUrl', () => {
  it('returns a url that actually serves the bytes', async () => {
    const ctx = await ws()
    const confirmed = await uploadFully(ctx)

    const url = await assets.createReadUrl(db, ctx, storage, confirmed.id)
    const response = await fetch(url)

    expect(response.ok).toBe(true)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(JPEG)
  })

  it('will not sign a url for another workspace’s asset', async () => {
    const ctx = await ws()
    const stranger = await ws()
    const confirmed = await uploadFully(ctx)

    // A signed URL outlives the request that produced it, so entitlement has
    // to be checked before signing rather than assumed from holding an id.
    await expect(assets.createReadUrl(db, stranger, storage, confirmed.id)).rejects.toThrow(
      NotFoundError,
    )
  })
})

describe('listAssets', () => {
  it('filters by status', async () => {
    const ctx = await ws()
    await assets.createUpload(db, ctx, storage, { mime: 'image/jpeg' })
    await uploadFully(ctx)

    const pending = await assets.listAssets(db, ctx, {
      status: 'pending',
      limit: 50,
      includeDeleted: false,
    })
    const uploaded = await assets.listAssets(db, ctx, {
      status: 'uploaded',
      limit: 50,
      includeDeleted: false,
    })

    expect(pending.items).toHaveLength(1)
    expect(uploaded.items).toHaveLength(1)
  })

  it('does not leak across workspaces', async () => {
    const mine = await ws()
    const theirs = await ws()
    await assets.createUpload(db, mine, storage, { mime: 'image/jpeg' })
    await assets.createUpload(db, theirs, storage, { mime: 'image/jpeg' })

    const { items } = await assets.listAssets(db, mine, { limit: 50, includeDeleted: false })

    expect(items).toHaveLength(1)
    expect(items[0]!.workspaceId).toBe(mine.workspaceId)
  })
})

describe('deleteAsset', () => {
  it('soft-deletes and leaves the bytes for the erase job', async () => {
    const ctx = await ws()
    const confirmed = await uploadFully(ctx)

    await assets.deleteAsset(db, ctx, confirmed.id)

    const visible = await assets.listAssets(db, ctx, { limit: 50, includeDeleted: false })
    expect(visible.items).toHaveLength(0)

    /**
     * The object deliberately survives. Deleting it here would make the
     * operation unrecoverable, and sync clients need the tombstone to learn
     * the asset went away. Bytes are removed by workspace prefix in the
     * GDPR erase job.
     */
    expect(await storage.head(confirmed.storageKey)).not.toBeNull()
  })
})
