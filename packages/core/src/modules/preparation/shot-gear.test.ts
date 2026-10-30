import { createDatabase, type Database } from '@pof/db'
import { testDatabaseUrls } from '@pof/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { NotFoundError } from '../../errors.ts'
import { newWorkspace } from '../../testing/fixtures.ts'
import * as shoots from '../planning/shoot.service.ts'
import * as gear from './gear.service.ts'
import * as shotGear from './shot-gear.service.ts'
import * as shots from './shot.service.ts'

let db: Database
let close: () => Promise<void>

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

/** A shoot, a shot on it, and a library item — the setup every test needs. */
async function scene(ctx: Awaited<ReturnType<typeof ws>>) {
  const shoot = await shoots.createShoot(db, ctx, {
    name: 'Requirement test shoot',
    shootTypeKey: 'portrait',
    status: 'planning',
  })
  const frame = await shots.createShot(db, ctx, {
    shootId: shoot.id,
    title: 'Hero frame',
    status: 'planned',
  })
  const item = await gear.createGearItem(db, ctx, { name: '85mm f/1.4' })

  return { shoot, frame, item }
}

describe('addShotGearRequirement', () => {
  it('requires a library item for a shot', async () => {
    const ctx = await ws()
    const { frame, item } = await scene(ctx)

    const created = await shotGear.addShotGearRequirement(db, ctx, {
      shotId: frame.id,
      gearItemId: item.id,
      quantity: 1,
      notes: 'wide open',
    })

    expect(created.shotId).toBe(frame.id)
    expect(created.gearItemId).toBe(item.id)
    expect(created.notes).toBe('wide open')
    expect(created.workspaceId).toBe(ctx.workspaceId)
  })

  it('returns the existing row when the same item is added twice', async () => {
    const ctx = await ws()
    const { frame, item } = await scene(ctx)

    const first = await shotGear.addShotGearRequirement(db, ctx, {
      shotId: frame.id,
      gearItemId: item.id,
      quantity: 1,
    })
    // Clicking "add" again is not an error.
    const second = await shotGear.addShotGearRequirement(db, ctx, {
      shotId: frame.id,
      gearItemId: item.id,
      quantity: 1,
    })

    expect(second.id).toBe(first.id)

    const { items } = await shotGear.listShotGearRequirements(db, ctx, {
      shotId: frame.id,
      limit: 50,
      includeDeleted: false,
    })
    expect(items).toHaveLength(1)
  })

  it('rejects a shot from another workspace', async () => {
    const mine = await ws()
    const theirs = await ws()
    const { frame } = await scene(theirs)
    const myItem = await gear.createGearItem(db, mine, { name: 'My reflector' })

    await expect(
      shotGear.addShotGearRequirement(db, mine, {
        shotId: frame.id,
        gearItemId: myItem.id,
        quantity: 1,
      }),
    ).rejects.toThrow(NotFoundError)
  })

  it('rejects a gear item from another workspace', async () => {
    const mine = await ws()
    const theirs = await ws()
    const { frame } = await scene(mine)
    const theirItem = await gear.createGearItem(db, theirs, { name: 'Their lens' })

    await expect(
      shotGear.addShotGearRequirement(db, mine, {
        shotId: frame.id,
        gearItemId: theirItem.id,
        quantity: 1,
      }),
    ).rejects.toThrow(NotFoundError)
  })

  it('rejects a deleted shot', async () => {
    const ctx = await ws()
    const { frame, item } = await scene(ctx)
    await shots.deleteShot(db, ctx, frame.id)

    await expect(
      shotGear.addShotGearRequirement(db, ctx, {
        shotId: frame.id,
        gearItemId: item.id,
        quantity: 1,
      }),
    ).rejects.toThrow(NotFoundError)
  })
})

describe('listShotGearRequirements', () => {
  it('scopes to one shot', async () => {
    const ctx = await ws()
    const { shoot, frame, item } = await scene(ctx)
    const other = await shots.createShot(db, ctx, {
      shootId: shoot.id,
      title: 'Second frame',
      status: 'planned',
    })
    const second = await gear.createGearItem(db, ctx, { name: 'Reflector' })

    await shotGear.addShotGearRequirement(db, ctx, {
      shotId: frame.id,
      gearItemId: item.id,
      quantity: 1,
    })
    await shotGear.addShotGearRequirement(db, ctx, {
      shotId: other.id,
      gearItemId: second.id,
      quantity: 1,
    })

    const { items } = await shotGear.listShotGearRequirements(db, ctx, {
      shotId: frame.id,
      limit: 50,
      includeDeleted: false,
    })

    expect(items).toHaveLength(1)
    expect(items[0]!.gearItemId).toBe(item.id)
  })

  it('does not leak across workspaces', async () => {
    const mine = await ws()
    const theirs = await ws()
    const a = await scene(mine)
    const b = await scene(theirs)

    await shotGear.addShotGearRequirement(db, mine, {
      shotId: a.frame.id,
      gearItemId: a.item.id,
      quantity: 1,
    })
    await shotGear.addShotGearRequirement(db, theirs, {
      shotId: b.frame.id,
      gearItemId: b.item.id,
      quantity: 1,
    })

    const { items } = await shotGear.listShotGearRequirements(db, mine, {
      limit: 50,
      includeDeleted: false,
    })

    expect(items).toHaveLength(1)
    expect(items[0]!.shotId).toBe(a.frame.id)
  })
})

describe('the shoot packing list and shot requirements are independent', () => {
  it('keeps them in separate tables', async () => {
    const ctx = await ws()
    const { shoot, frame, item } = await scene(ctx)

    // The same lens can be on the packing list AND required by a frame.
    await gear.addShootGear(db, ctx, { shootId: shoot.id, gearItemId: item.id, quantity: 1 })
    await shotGear.addShotGearRequirement(db, ctx, {
      shotId: frame.id,
      gearItemId: item.id,
      quantity: 1,
    })

    const packing = await gear.listShootGear(db, ctx, {
      shootId: shoot.id,
      limit: 50,
      includeDeleted: false,
    })
    const required = await shotGear.listShotGearRequirements(db, ctx, {
      shotId: frame.id,
      limit: 50,
      includeDeleted: false,
    })

    expect(packing.items).toHaveLength(1)
    expect(required.items).toHaveLength(1)

    // Unpacking the bag does not un-require the lens for the frame.
    await gear.removeShootGear(db, ctx, packing.items[0]!.id)

    const stillRequired = await shotGear.listShotGearRequirements(db, ctx, {
      shotId: frame.id,
      limit: 50,
      includeDeleted: false,
    })
    expect(stillRequired.items).toHaveLength(1)
  })
})

describe('updateShotGearRequirement', () => {
  it('changes quantity and notes', async () => {
    const ctx = await ws()
    const { frame, item } = await scene(ctx)
    const created = await shotGear.addShotGearRequirement(db, ctx, {
      shotId: frame.id,
      gearItemId: item.id,
      quantity: 1,
    })

    const updated = await shotGear.updateShotGearRequirement(db, ctx, {
      id: created.id,
      quantity: 2,
      notes: 'one gelled',
    })

    expect(updated.quantity).toBe(2)
    expect(updated.notes).toBe('one gelled')
  })

  it('cannot be updated from another workspace', async () => {
    const ctx = await ws()
    const stranger = await ws()
    const { frame, item } = await scene(ctx)
    const created = await shotGear.addShotGearRequirement(db, ctx, {
      shotId: frame.id,
      gearItemId: item.id,
      quantity: 1,
    })

    await expect(
      shotGear.updateShotGearRequirement(db, stranger, { id: created.id, quantity: 99 }),
    ).rejects.toThrow(NotFoundError)
  })
})

describe('removeShotGearRequirement', () => {
  it('soft-deletes and hides from the default list', async () => {
    const ctx = await ws()
    const { frame, item } = await scene(ctx)
    const created = await shotGear.addShotGearRequirement(db, ctx, {
      shotId: frame.id,
      gearItemId: item.id,
      quantity: 1,
    })

    await shotGear.removeShotGearRequirement(db, ctx, created.id)

    const visible = await shotGear.listShotGearRequirements(db, ctx, {
      shotId: frame.id,
      limit: 50,
      includeDeleted: false,
    })
    expect(visible.items).toHaveLength(0)

    const withDeleted = await shotGear.listShotGearRequirements(db, ctx, {
      shotId: frame.id,
      limit: 50,
      includeDeleted: true,
    })
    expect(withDeleted.items).toHaveLength(1)
  })
})

describe('deleting a shot', () => {
  it('leaves its requirements reachable as tombstones', async () => {
    const ctx = await ws()
    const { frame, item } = await scene(ctx)
    await shotGear.addShotGearRequirement(db, ctx, {
      shotId: frame.id,
      gearItemId: item.id,
      quantity: 1,
    })

    // Soft delete, so the FK cascade does not fire and offline clients can
    // still be told what went away.
    await shots.deleteShot(db, ctx, frame.id)

    const { items } = await shotGear.listShotGearRequirements(db, ctx, {
      shotId: frame.id,
      limit: 50,
      includeDeleted: true,
    })
    expect(items).toHaveLength(1)
  })
})
