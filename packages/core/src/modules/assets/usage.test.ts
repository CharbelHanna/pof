import { createDatabase, type Database } from '@pof/db'
import { testDatabaseUrls } from '@pof/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createS3Storage } from '../../adapters/s3-storage.ts'
import type { ImageMetadata, ImagePort, RenderedVariant, VariantSpec } from '../../ports/image.ts'
import type { StoragePort } from '../../ports/storage.ts'
import { newWorkspace } from '../../testing/fixtures.ts'
import { testStorage } from '../../testing/storage.ts'
import * as assets from './asset.service.ts'
import { processAsset } from './process.service.ts'
import { getUsage, recomputeUsage } from './usage.service.ts'

/**
 * The counter is an optimisation over `SUM(bytes)`, so the property that
 * matters is not any particular number — it is that the incremental deltas
 * and a full recompute agree. Most of these assert exactly that, because a
 * counter that drifts is worse than no counter: it is wrong silently, and
 * it is what a limit check would believe.
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

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])

/** Each rendered variant is a fixed, known size, so totals are predictable. */
const VARIANT_BYTES = 100

function fakeImage(overrides: Partial<ImagePort> = {}): ImagePort {
  return {
    async inspect(): Promise<ImageMetadata> {
      return { width: 100, height: 100 }
    },
    async render(_input: Uint8Array, spec: VariantSpec): Promise<RenderedVariant> {
      return {
        name: spec.name,
        format: spec.format,
        width: spec.width,
        height: spec.width,
        bytes: new Uint8Array(VARIANT_BYTES),
      }
    },
    ...overrides,
  }
}

async function uploadOne(ctx: Awaited<ReturnType<typeof ws>>) {
  const { asset, target } = await assets.createUpload(db, ctx, storage, { mime: 'image/jpeg' })
  await fetch(target.url, { method: target.method, headers: target.headers, body: JPEG })
  return assets.confirmUpload(db, ctx, storage, { id: asset.id })
}

describe('usage', () => {
  it('is zero for a workspace that has uploaded nothing', async () => {
    const ctx = await ws()

    // Absence of a row means nothing uploaded, not an error.
    expect(await getUsage(db, ctx)).toEqual({ storageBytes: 0, assetCount: 0 })
  })

  it('counts the original when an upload is confirmed', async () => {
    const ctx = await ws()
    await uploadOne(ctx)

    const usage = await getUsage(db, ctx)
    expect(usage.assetCount).toBe(1)
    expect(usage.storageBytes).toBe(JPEG.byteLength)
  })

  it('does not count an upload that was never confirmed', async () => {
    const ctx = await ws()

    // A `pending` row has no object behind it.
    await assets.createUpload(db, ctx, storage, { mime: 'image/jpeg' })

    expect(await getUsage(db, ctx)).toEqual({ storageBytes: 0, assetCount: 0 })
  })

  it('adds the derivatives when processing finishes', async () => {
    const ctx = await ws()
    const asset = await uploadOne(ctx)

    await processAsset(db, ctx, storage, fakeImage(), asset.id)

    const usage = await getUsage(db, ctx)
    // Six derivatives, which for a small original dwarf it — the reason
    // they are counted at all.
    expect(usage.storageBytes).toBe(JPEG.byteLength + 6 * VARIANT_BYTES)
    expect(usage.assetCount).toBe(1)
  })

  /**
   * The property the delta design exists for. Jobs retry — that is the
   * whole point of the transient-failure path — and a counter that grew on
   * every retry would be silently wrong forever.
   */
  it('does not inflate when processing runs again', async () => {
    const ctx = await ws()
    const asset = await uploadOne(ctx)

    await processAsset(db, ctx, storage, fakeImage(), asset.id)
    const afterFirst = await getUsage(db, ctx)

    // Idempotent once ready, so this returns early — but the assertion is
    // about the counter, not the early return.
    await processAsset(db, ctx, storage, fakeImage(), asset.id)

    expect(await getUsage(db, ctx)).toEqual(afterFirst)
  })

  it('gives the bytes back when an asset is deleted', async () => {
    const ctx = await ws()
    const asset = await uploadOne(ctx)
    await processAsset(db, ctx, storage, fakeImage(), asset.id)

    await assets.deleteAsset(db, ctx, asset.id)

    expect(await getUsage(db, ctx)).toEqual({ storageBytes: 0, assetCount: 0 })
  })

  it('does not subtract for an asset that was never counted', async () => {
    const ctx = await ws()
    const confirmed = await uploadOne(ctx)
    const { asset: pending } = await assets.createUpload(db, ctx, storage, { mime: 'image/jpeg' })

    const before = await getUsage(db, ctx)
    await assets.deleteAsset(db, ctx, pending.id)

    // Deleting a never-confirmed asset must not drive the figure below what
    // the workspace actually holds.
    expect(await getUsage(db, ctx)).toEqual(before)
    expect(confirmed.id).toBeTruthy()
  })

  describe('agrees with a full recompute', () => {
    it('after uploads, processing and a deletion', async () => {
      const ctx = await ws()

      const kept = await uploadOne(ctx)
      await processAsset(db, ctx, storage, fakeImage(), kept.id)

      const removed = await uploadOne(ctx)
      await processAsset(db, ctx, storage, fakeImage(), removed.id)
      await assets.deleteAsset(db, ctx, removed.id)

      // Unprocessed, so it contributes only its original.
      await uploadOne(ctx)

      const incremental = await getUsage(db, ctx)
      const recomputed = await recomputeUsage(db, ctx)

      /**
       * The real assertion of this file. If the deltas are right these are
       * identical; if any path forgot to account for itself, they diverge.
       */
      expect(incremental).toEqual(recomputed)
      expect(recomputed.assetCount).toBe(2)
    })

    it('after a failed processing run', async () => {
      const ctx = await ws()
      const asset = await uploadOne(ctx)

      const broken = fakeImage({
        async inspect() {
          throw new Error('not an image')
        },
      })
      await processAsset(db, ctx, storage, broken, asset.id)

      // A failed asset still occupies its original, and nothing more.
      const incremental = await getUsage(db, ctx)
      expect(incremental).toEqual(await recomputeUsage(db, ctx))
      expect(incremental.storageBytes).toBe(JPEG.byteLength)
    })
  })

  it('counts each workspace separately', async () => {
    const mine = await ws()
    const theirs = await ws()

    await uploadOne(mine)
    await uploadOne(theirs)
    await uploadOne(theirs)

    expect((await getUsage(db, mine)).assetCount).toBe(1)
    expect((await getUsage(db, theirs)).assetCount).toBe(2)
  })
})
