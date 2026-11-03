import { createDatabase, type Database } from '@pof/db'
import { testDatabaseUrls } from '@pof/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createS3Storage } from '../../adapters/s3-storage.ts'
import { NotFoundError, ValidationError } from '../../errors.ts'
import type { StoragePort } from '../../ports/storage.ts'
import { newWorkspace } from '../../testing/fixtures.ts'
import { testStorage } from '../../testing/storage.ts'
import * as shoots from '../planning/shoot.service.ts'
import * as assets from './asset.service.ts'
import * as moodboards from './moodboard.service.ts'

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

/** A shoot, a board on it, and an asset to put there. */
async function scene(ctx: Awaited<ReturnType<typeof ws>>) {
  const shoot = await shoots.createShoot(db, ctx, {
    name: 'Board test shoot',
    shootTypeKey: 'editorial',
    status: 'planned',
  })
  const board = await moodboards.createMoodboard(db, ctx, {
    shootId: shoot.id,
    name: 'References',
  })
  const { asset } = await assets.createUpload(db, ctx, storage, { mime: 'image/jpeg' })

  return { shoot, board, asset }
}

describe('createMoodboard', () => {
  it('creates a board against a shoot', async () => {
    const ctx = await ws()
    const { board, shoot } = await scene(ctx)

    expect(board.shootId).toBe(shoot.id)
    expect(board.name).toBe('References')
  })

  it('rejects a shoot from another workspace', async () => {
    const mine = await ws()
    const theirs = await ws()
    const { shoot } = await scene(theirs)

    await expect(
      moodboards.createMoodboard(db, mine, { shootId: shoot.id, name: 'Trespassing' }),
    ).rejects.toThrow(NotFoundError)
  })
})

describe('addMoodboardItem', () => {
  it('puts an asset on a board', async () => {
    const ctx = await ws()
    const { board, asset } = await scene(ctx)

    const item = await moodboards.addMoodboardItem(db, ctx, {
      moodboardId: board.id,
      assetId: asset.id,
      caption: 'this light',
    })

    expect(item.assetId).toBe(asset.id)
    expect(item.caption).toBe('this light')
  })

  /**
   * The reason assets and items are separate tables: one uploaded reference
   * can appear on two boards without the file existing twice.
   */
  it('allows one asset on two different boards', async () => {
    const ctx = await ws()
    const { shoot, board, asset } = await scene(ctx)
    const second = await moodboards.createMoodboard(db, ctx, {
      shootId: shoot.id,
      name: 'Rejects',
    })

    await moodboards.addMoodboardItem(db, ctx, { moodboardId: board.id, assetId: asset.id })
    await moodboards.addMoodboardItem(db, ctx, { moodboardId: second.id, assetId: asset.id })

    const a = await moodboards.listMoodboardItems(db, ctx, {
      moodboardId: board.id,
      limit: 50,
      includeDeleted: false,
    })
    const b = await moodboards.listMoodboardItems(db, ctx, {
      moodboardId: second.id,
      limit: 50,
      includeDeleted: false,
    })

    expect(a.items).toHaveLength(1)
    expect(b.items).toHaveLength(1)
  })

  it('returns the existing item when the same asset is dropped twice', async () => {
    const ctx = await ws()
    const { board, asset } = await scene(ctx)

    const first = await moodboards.addMoodboardItem(db, ctx, {
      moodboardId: board.id,
      assetId: asset.id,
    })
    // Releasing the mouse over a tile that is already there is not an error.
    const again = await moodboards.addMoodboardItem(db, ctx, {
      moodboardId: board.id,
      assetId: asset.id,
    })

    expect(again.id).toBe(first.id)
  })

  it('appends in order', async () => {
    const ctx = await ws()
    const { board } = await scene(ctx)

    const made = []
    for (let i = 0; i < 3; i += 1) {
      const { asset } = await assets.createUpload(db, ctx, storage, { mime: 'image/jpeg' })
      made.push(
        await moodboards.addMoodboardItem(db, ctx, {
          moodboardId: board.id,
          assetId: asset.id,
        }),
      )
    }

    expect(made[1]!.position).toBeGreaterThan(made[0]!.position)
    expect(made[2]!.position).toBeGreaterThan(made[1]!.position)
  })

  it('rejects an asset from another workspace', async () => {
    const mine = await ws()
    const theirs = await ws()
    const a = await scene(mine)
    const b = await scene(theirs)

    await expect(
      moodboards.addMoodboardItem(db, mine, {
        moodboardId: a.board.id,
        assetId: b.asset.id,
      }),
    ).rejects.toThrow(NotFoundError)
  })

  it('rejects a deleted asset', async () => {
    const ctx = await ws()
    const { board, asset } = await scene(ctx)
    await assets.deleteAsset(db, ctx, asset.id)

    // The composite key would allow this; the service should not.
    await expect(
      moodboards.addMoodboardItem(db, ctx, { moodboardId: board.id, assetId: asset.id }),
    ).rejects.toThrow(NotFoundError)
  })
})

describe('reorderMoodboard', () => {
  async function boardOfThree() {
    const ctx = await ws()
    const { board } = await scene(ctx)
    const made = []
    for (let i = 0; i < 3; i += 1) {
      const { asset } = await assets.createUpload(db, ctx, storage, { mime: 'image/jpeg' })
      made.push(
        await moodboards.addMoodboardItem(db, ctx, { moodboardId: board.id, assetId: asset.id }),
      )
    }
    return { ctx, board, made }
  }

  async function orderOf(ctx: Awaited<ReturnType<typeof ws>>, boardId: string) {
    const { items } = await moodboards.listMoodboardItems(db, ctx, {
      moodboardId: boardId,
      limit: 50,
      includeDeleted: false,
    })
    return items.sort((a, b) => a.position - b.position).map((i) => i.id)
  }

  it('rewrites the arrangement', async () => {
    const { ctx, board, made } = await boardOfThree()

    await moodboards.reorderMoodboard(db, ctx, {
      moodboardId: board.id,
      orderedIds: [made[2]!.id, made[0]!.id, made[1]!.id],
    })

    expect(await orderOf(ctx, board.id)).toEqual([made[2]!.id, made[0]!.id, made[1]!.id])
  })

  it('rejects a partial list rather than silently interleaving', async () => {
    const { ctx, board, made } = await boardOfThree()

    await expect(
      moodboards.reorderMoodboard(db, ctx, {
        moodboardId: board.id,
        orderedIds: [made[0]!.id, made[1]!.id],
      }),
    ).rejects.toThrow(ValidationError)

    expect(await orderOf(ctx, board.id)).toEqual(made.map((i) => i.id))
  })

  it('cannot rearrange another workspace’s board', async () => {
    const { board, made } = await boardOfThree()
    const stranger = await ws()

    await expect(
      moodboards.reorderMoodboard(db, stranger, {
        moodboardId: board.id,
        orderedIds: made.map((i) => i.id),
      }),
    ).rejects.toThrow(NotFoundError)
  })
})

describe('removeMoodboardItem', () => {
  it('takes the image off the board but leaves the asset alone', async () => {
    const ctx = await ws()
    const { board, asset } = await scene(ctx)
    const item = await moodboards.addMoodboardItem(db, ctx, {
      moodboardId: board.id,
      assetId: asset.id,
    })

    await moodboards.removeMoodboardItem(db, ctx, item.id)

    const { items } = await moodboards.listMoodboardItems(db, ctx, {
      moodboardId: board.id,
      limit: 50,
      includeDeleted: false,
    })
    expect(items).toHaveLength(0)

    // Curation and storage are separate concerns: removing a reference from
    // one board must not delete the file, which may be on another.
    const stillThere = await assets.listAssets(db, ctx, { limit: 50, includeDeleted: false })
    expect(stillThere.items.some((a) => a.id === asset.id)).toBe(true)
  })
})

describe('listMoodboards', () => {
  it('does not leak across workspaces', async () => {
    const mine = await ws()
    const theirs = await ws()
    await scene(mine)
    await scene(theirs)

    const { items } = await moodboards.listMoodboards(db, mine, {
      limit: 50,
      includeDeleted: false,
    })

    expect(items).toHaveLength(1)
    expect(items[0]!.workspaceId).toBe(mine.workspaceId)
  })
})
