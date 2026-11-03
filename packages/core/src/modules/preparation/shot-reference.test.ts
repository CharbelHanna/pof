import { createDatabase, type Database } from '@pof/db'
import { testDatabaseUrls } from '@pof/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createS3Storage } from '../../adapters/s3-storage.ts'
import { NotFoundError } from '../../errors.ts'
import type { StoragePort } from '../../ports/storage.ts'
import { newWorkspace } from '../../testing/fixtures.ts'
import { testStorage } from '../../testing/storage.ts'
import * as assets from '../assets/asset.service.ts'
import * as moodboards from '../assets/moodboard.service.ts'
import * as shoots from '../planning/shoot.service.ts'
import * as shots from './shot.service.ts'
import * as shotReferences from './shot-reference.service.ts'

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

/** A shoot with one shot, and an asset to reference from it. */
async function scene(ctx: Awaited<ReturnType<typeof ws>>) {
  const shoot = await shoots.createShoot(db, ctx, {
    name: 'Reference test shoot',
    shootTypeKey: 'portrait',
    status: 'planned',
  })
  const frame = await shots.createShot(db, ctx, {
    shootId: shoot.id,
    title: 'Hero frame',
    status: 'planned',
  })
  const { asset } = await assets.createUpload(db, ctx, storage, { mime: 'image/jpeg' })

  return { shoot, frame, asset }
}

describe('addShotReference', () => {
  it('attaches an image to a shot', async () => {
    const ctx = await ws()
    const { frame, asset } = await scene(ctx)

    const reference = await shotReferences.addShotReference(db, ctx, {
      shotId: frame.id,
      assetId: asset.id,
      note: 'this crop',
    })

    expect(reference.shotId).toBe(frame.id)
    expect(reference.assetId).toBe(asset.id)
    expect(reference.note).toBe('this crop')
  })

  /**
   * The reason `asset` is decoupled from both curation tables: one uploaded
   * file is routinely a mood for the shoot AND an instruction for one
   * frame. If either owned it, the second use would be a copy.
   */
  it('lets one asset be both a moodboard item and a shot reference', async () => {
    const ctx = await ws()
    const { shoot, frame, asset } = await scene(ctx)

    const board = await moodboards.createMoodboard(db, ctx, {
      shootId: shoot.id,
      name: 'References',
    })
    await moodboards.addMoodboardItem(db, ctx, { moodboardId: board.id, assetId: asset.id })
    await shotReferences.addShotReference(db, ctx, { shotId: frame.id, assetId: asset.id })

    const onBoard = await moodboards.listMoodboardItems(db, ctx, {
      moodboardId: board.id,
      limit: 50,
      includeDeleted: false,
    })
    const onShot = await shotReferences.listShotReferences(db, ctx, {
      shotId: frame.id,
      limit: 50,
      includeDeleted: false,
    })

    expect(onBoard.items).toHaveLength(1)
    expect(onShot.items).toHaveLength(1)

    // And still exactly one file.
    const stored = await assets.listAssets(db, ctx, { limit: 50, includeDeleted: false })
    expect(stored.items.filter((a) => a.id === asset.id)).toHaveLength(1)
  })

  it('returns the existing row when the same image is attached twice', async () => {
    const ctx = await ws()
    const { frame, asset } = await scene(ctx)

    const first = await shotReferences.addShotReference(db, ctx, {
      shotId: frame.id,
      assetId: asset.id,
    })
    const again = await shotReferences.addShotReference(db, ctx, {
      shotId: frame.id,
      assetId: asset.id,
    })

    expect(again.id).toBe(first.id)
  })

  it('appends in order', async () => {
    const ctx = await ws()
    const { frame } = await scene(ctx)

    const made = []
    for (let i = 0; i < 3; i += 1) {
      const { asset } = await assets.createUpload(db, ctx, storage, { mime: 'image/jpeg' })
      made.push(
        await shotReferences.addShotReference(db, ctx, { shotId: frame.id, assetId: asset.id }),
      )
    }

    expect(made[1]!.position).toBeGreaterThan(made[0]!.position)
    expect(made[2]!.position).toBeGreaterThan(made[1]!.position)
  })

  it('rejects a shot from another workspace', async () => {
    const mine = await ws()
    const theirs = await ws()
    const a = await scene(mine)
    const b = await scene(theirs)

    await expect(
      shotReferences.addShotReference(db, mine, { shotId: b.frame.id, assetId: a.asset.id }),
    ).rejects.toThrow(NotFoundError)
  })

  it('rejects an asset from another workspace', async () => {
    const mine = await ws()
    const theirs = await ws()
    const a = await scene(mine)
    const b = await scene(theirs)

    await expect(
      shotReferences.addShotReference(db, mine, { shotId: a.frame.id, assetId: b.asset.id }),
    ).rejects.toThrow(NotFoundError)
  })

  it('rejects a deleted asset', async () => {
    const ctx = await ws()
    const { frame, asset } = await scene(ctx)
    await assets.deleteAsset(db, ctx, asset.id)

    // The composite key would allow this; the service should not.
    await expect(
      shotReferences.addShotReference(db, ctx, { shotId: frame.id, assetId: asset.id }),
    ).rejects.toThrow(NotFoundError)
  })

  it('rejects a deleted shot', async () => {
    const ctx = await ws()
    const { frame, asset } = await scene(ctx)
    await shots.deleteShot(db, ctx, frame.id)

    await expect(
      shotReferences.addShotReference(db, ctx, { shotId: frame.id, assetId: asset.id }),
    ).rejects.toThrow(NotFoundError)
  })
})

describe('listShotReferences', () => {
  it('scopes to one shot', async () => {
    const ctx = await ws()
    const { shoot, frame, asset } = await scene(ctx)
    const other = await shots.createShot(db, ctx, {
      shootId: shoot.id,
      title: 'Second frame',
      status: 'planned',
    })
    const { asset: second } = await assets.createUpload(db, ctx, storage, { mime: 'image/jpeg' })

    await shotReferences.addShotReference(db, ctx, { shotId: frame.id, assetId: asset.id })
    await shotReferences.addShotReference(db, ctx, { shotId: other.id, assetId: second.id })

    const { items } = await shotReferences.listShotReferences(db, ctx, {
      shotId: frame.id,
      limit: 50,
      includeDeleted: false,
    })

    expect(items).toHaveLength(1)
    expect(items[0]!.assetId).toBe(asset.id)
  })

  it('does not leak across workspaces', async () => {
    const mine = await ws()
    const theirs = await ws()
    const a = await scene(mine)
    const b = await scene(theirs)

    await shotReferences.addShotReference(db, mine, { shotId: a.frame.id, assetId: a.asset.id })
    await shotReferences.addShotReference(db, theirs, { shotId: b.frame.id, assetId: b.asset.id })

    const { items } = await shotReferences.listShotReferences(db, mine, {
      limit: 50,
      includeDeleted: false,
    })

    expect(items).toHaveLength(1)
    expect(items[0]!.shotId).toBe(a.frame.id)
  })
})

describe('removeShotReference', () => {
  it('detaches the image but leaves the asset alone', async () => {
    const ctx = await ws()
    const { frame, asset } = await scene(ctx)
    const reference = await shotReferences.addShotReference(db, ctx, {
      shotId: frame.id,
      assetId: asset.id,
    })

    await shotReferences.removeShotReference(db, ctx, reference.id)

    const { items } = await shotReferences.listShotReferences(db, ctx, {
      shotId: frame.id,
      limit: 50,
      includeDeleted: false,
    })
    expect(items).toHaveLength(0)

    // Detaching from one frame must not delete a file that may be on a
    // moodboard or another shot.
    const stored = await assets.listAssets(db, ctx, { limit: 50, includeDeleted: false })
    expect(stored.items.some((a) => a.id === asset.id)).toBe(true)
  })

  it('cannot be removed from another workspace', async () => {
    const ctx = await ws()
    const stranger = await ws()
    const { frame, asset } = await scene(ctx)
    const reference = await shotReferences.addShotReference(db, ctx, {
      shotId: frame.id,
      assetId: asset.id,
    })

    await expect(shotReferences.removeShotReference(db, stranger, reference.id)).rejects.toThrow(
      NotFoundError,
    )
  })
})
