import { createDatabase, schema, withTenant, type Database } from '@pof/db'
import { testDatabaseUrls } from '@pof/db/testing'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createS3Storage } from '../../adapters/s3-storage.ts'
import type { ImageMetadata, ImagePort, RenderedVariant, VariantSpec } from '../../ports/image.ts'
import type { StoragePort } from '../../ports/storage.ts'
import { newWorkspace } from '../../testing/fixtures.ts'
import { testStorage } from '../../testing/storage.ts'
import * as assets from './asset.service.ts'
import { processAsset, VARIANT_SPECS } from './process.service.ts'

/**
 * Real database, real storage, fake image library.
 *
 * The split is deliberate. Storage is real because the things worth testing
 * here — does a derivative actually land, does the original survive — are
 * properties of a server. The image library is faked because what this
 * service decides is the ORCHESTRATION: which failures are permanent, which
 * are transient, what the row looks like afterwards. Running libvips would
 * test sharp, which sharp already tests.
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

/** Produces plausible output without loading an image library. */
function fakeImage(overrides: Partial<ImagePort> = {}): ImagePort {
  return {
    async inspect(): Promise<ImageMetadata> {
      return { width: 4000, height: 3000, capturedAt: new Date('2027-06-21T03:30:00Z') }
    },
    async render(_input: Uint8Array, spec: VariantSpec): Promise<RenderedVariant> {
      return {
        name: spec.name,
        format: spec.format,
        width: spec.width,
        height: Math.round((spec.width * 3) / 4),
        bytes: new Uint8Array([1, 2, 3, 4]),
      }
    },
    ...overrides,
  }
}

/** Get an asset to `uploaded`, which is where processing begins. */
async function uploaded(ctx: Awaited<ReturnType<typeof ws>>) {
  const { asset, target } = await assets.createUpload(db, ctx, storage, { mime: 'image/jpeg' })
  await fetch(target.url, { method: target.method, headers: target.headers, body: JPEG })
  return assets.confirmUpload(db, ctx, storage, { id: asset.id })
}

/**
 * Read a row back under tenant scope.
 *
 * Via `withTenant`, not a raw handle — `asset` has FORCE row-level security,
 * so an unscoped select returns zero rows rather than erroring. The first
 * version of this helper used `db.select()` directly and every assertion
 * failed on `undefined`, which is the policy doing its job: it fails closed,
 * silently, exactly as the architecture notes warn.
 */
async function reload(ctx: Awaited<ReturnType<typeof ws>>, id: string) {
  return withTenant(db, ctx, async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.asset)
      .where(and(eq(schema.asset.id, id), eq(schema.asset.workspaceId, ctx.workspaceId)))
      .limit(1)
    return row!
  })
}

describe('processAsset', () => {
  it('renders every variant and marks the asset ready', async () => {
    const ctx = await ws()
    const asset = await uploaded(ctx)

    const result = await processAsset(db, ctx, storage, fakeImage(), asset.id)

    expect(result.status).toBe('ready')

    const row = await reload(ctx, asset.id)
    expect(row.status).toBe('ready')
    expect(row.width).toBe(4000)
    expect(row.height).toBe(3000)
    expect(row.capturedAt?.toISOString()).toBe('2027-06-21T03:30:00.000Z')
  })

  it('writes each derivative to storage beside the original', async () => {
    const ctx = await ws()
    const asset = await uploaded(ctx)

    await processAsset(db, ctx, storage, fakeImage(), asset.id)

    const row = await reload(ctx, asset.id)
    const variants = row.variants as Record<string, Record<string, { key: string }>>

    // Every spec produced an object that is really there — not just a row
    // claiming it did.
    for (const spec of VARIANT_SPECS) {
      const descriptor = variants[spec.name]?.[spec.format]
      expect(descriptor, `${spec.name}.${spec.format}`).toBeDefined()
      expect(await storage.head(descriptor!.key)).not.toBeNull()
    }

    // And the original survives: derivatives are additions, not a rewrite.
    expect(await storage.head(row.storageKey)).not.toBeNull()
  })

  it('is idempotent once ready', async () => {
    const ctx = await ws()
    const asset = await uploaded(ctx)
    await processAsset(db, ctx, storage, fakeImage(), asset.id)

    let renders = 0
    const counting = fakeImage({
      async render(_input, spec) {
        renders += 1
        return {
          name: spec.name,
          format: spec.format,
          width: spec.width,
          height: spec.width,
          bytes: new Uint8Array([0]),
        }
      },
    })

    // A retry after the status write but before the job was acknowledged
    // must not re-render six files for nothing.
    const again = await processAsset(db, ctx, storage, counting, asset.id)

    expect(again.status).toBe('ready')
    expect(renders).toBe(0)
  })

  describe('failures', () => {
    it('records an unreadable file as failed, with a reason the user can read', async () => {
      const ctx = await ws()
      const asset = await uploaded(ctx)

      const broken = fakeImage({
        async inspect() {
          throw new Error('That file does not appear to be an image')
        },
      })

      const result = await processAsset(db, ctx, storage, broken, asset.id)

      expect(result.status).toBe('failed')

      const row = await reload(ctx, asset.id)
      expect(row.status).toBe('failed')
      // Shown in place of a thumbnail, so it has to be a sentence rather
      // than a stack trace.
      expect(row.failureReason).toMatch(/does not appear to be an image/)
    })

    it('records a render failure as failed', async () => {
      const ctx = await ws()
      const asset = await uploaded(ctx)

      const broken = fakeImage({
        async render() {
          throw new Error('Unsupported colour profile')
        },
      })

      const result = await processAsset(db, ctx, storage, broken, asset.id)

      expect(result.status).toBe('failed')
      expect((await reload(ctx, asset.id)).failureReason).toMatch(/colour profile/)
    })

    /**
     * The distinction this service exists to get right.
     *
     * A bad file fails the same way every time, so recording it is correct.
     * Storage being unreachable is transient — marking those assets
     * permanently failed would mean one outage silently ruined every upload
     * in flight, with no path back. Transient faults must escape so the
     * queue retries them.
     */
    it('lets a storage outage throw rather than failing the asset forever', async () => {
      const ctx = await ws()
      const asset = await uploaded(ctx)

      const brokenStorage: StoragePort = {
        ...storage,
        async get() {
          throw new Error('connection refused')
        },
      }

      await expect(processAsset(db, ctx, brokenStorage, fakeImage(), asset.id)).rejects.toThrow(
        /connection refused/,
      )

      // Still `uploaded`, so a retry can pick it up.
      expect((await reload(ctx, asset.id)).status).toBe('uploaded')
    })

    it('lets a failed write throw rather than marking the asset failed', async () => {
      const ctx = await ws()
      const asset = await uploaded(ctx)

      const brokenStorage: StoragePort = {
        ...storage,
        async put() {
          throw new Error('bucket is read-only')
        },
      }

      await expect(processAsset(db, ctx, brokenStorage, fakeImage(), asset.id)).rejects.toThrow(
        /read-only/,
      )

      expect((await reload(ctx, asset.id)).status).toBe('uploaded')
    })
  })

  it('will not process another workspace’s asset', async () => {
    const ctx = await ws()
    const stranger = await ws()
    const asset = await uploaded(ctx)

    // The worker has no session, so the workspace comes off the job payload.
    // A payload naming the wrong one must find nothing, not someone's files.
    await expect(processAsset(db, stranger, storage, fakeImage(), asset.id)).rejects.toThrow()
  })
})
