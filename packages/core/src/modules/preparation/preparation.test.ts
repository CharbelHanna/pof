import { createDatabase, type Database } from '@pof/db'
import { testDatabaseUrls } from '@pof/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { NotFoundError, ValidationError } from '../../errors.ts'
import { newWorkspace, sessionWindow } from '../../testing/fixtures.ts'
import * as sessions from '../planning/session.service.ts'
import * as shoots from '../planning/shoot.service.ts'
import * as crew from './crew.service.ts'
import * as gear from './gear.service.ts'

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
const aShoot = (ctx: Awaited<ReturnType<typeof ws>>, name = 'Parent') =>
  shoots.createShoot(db, ctx, { name, shootTypeKey: 'portrait', status: 'draft' })

describe('crew', () => {
  it('adds a crew member to a shoot', async () => {
    const ctx = await ws()
    const shoot = await aShoot(ctx)

    const member = await crew.createCrewMember(db, ctx, {
      shootId: shoot.id,
      role: 'Assistant',
      name: 'Sam',
    })

    expect(member.role).toBe('Assistant')
    expect(member.name).toBe('Sam')
    // Null session means the whole shoot, which is the common case.
    expect(member.sessionId).toBeNull()
  })

  it('accepts a role the product never anticipated', async () => {
    const ctx = await ws()
    const shoot = await aShoot(ctx)

    // Free text rather than a reference table: real crews invent roles, and
    // nothing branches on this value.
    const member = await crew.createCrewMember(db, ctx, {
      shootId: shoot.id,
      role: 'Dog handler',
    })

    expect(member.role).toBe('Dog handler')
  })

  it('can be narrowed to a single session', async () => {
    const ctx = await ws()
    const shoot = await aShoot(ctx)
    const { startsAt, endsAt } = sessionWindow()
    const session = await sessions.createSession(db, ctx, {
      shootId: shoot.id,
      name: 'Studio day',
      status: 'planned',
      startsAt,
      endsAt,
      timezone: 'UTC',
    })

    const member = await crew.createCrewMember(db, ctx, {
      shootId: shoot.id,
      sessionId: session.id,
      role: 'Assistant',
    })

    expect(member.sessionId).toBe(session.id)
  })

  it('refuses a session belonging to a different shoot', async () => {
    const ctx = await ws()
    const [first, second] = [await aShoot(ctx, 'First'), await aShoot(ctx, 'Second')]
    const { startsAt, endsAt } = sessionWindow()
    const otherSession = await sessions.createSession(db, ctx, {
      shootId: second.id,
      name: "Second's session",
      status: 'planned',
      startsAt,
      endsAt,
      timezone: 'UTC',
    })

    // Same workspace, so tenancy does not catch this — the composite key
    // includes shoot_id precisely so the database does.
    await expect(
      crew.createCrewMember(db, ctx, {
        shootId: first.id,
        sessionId: otherSession.id,
        role: 'Assistant',
      }),
    ).rejects.toThrow()
  })

  it('refuses crew on a deleted shoot', async () => {
    const ctx = await ws()
    const shoot = await aShoot(ctx)
    await shoots.deleteShoot(db, ctx, shoot.id)

    await expect(
      crew.createCrewMember(db, ctx, { shootId: shoot.id, role: 'Assistant' }),
    ).rejects.toThrow(ValidationError)
  })

  it("hides another workspace's crew", async () => {
    const [a, b] = [await ws(), await ws()]
    const shoot = await aShoot(a)
    await crew.createCrewMember(db, a, { shootId: shoot.id, role: 'Assistant' })

    const seenByB = await crew.listCrew(db, b, { limit: 100, includeDeleted: false })
    expect(seenByB.items).toHaveLength(0)
  })

  it('soft-deletes', async () => {
    const ctx = await ws()
    const shoot = await aShoot(ctx)
    const member = await crew.createCrewMember(db, ctx, {
      shootId: shoot.id,
      role: 'Assistant',
    })

    await crew.deleteCrewMember(db, ctx, member.id)

    const visible = await crew.listCrew(db, ctx, {
      shootId: shoot.id,
      limit: 100,
      includeDeleted: false,
    })
    expect(visible.items).toHaveLength(0)
  })
})

describe('gear library', () => {
  it('holds kit independently of any shoot', async () => {
    const ctx = await ws()

    const item = await gear.createGearItem(db, ctx, { name: '85mm f/1.4', category: 'Lens' })

    expect(item.name).toBe('85mm f/1.4')
    expect(item.category).toBe('Lens')
  })

  it("hides another workspace's library", async () => {
    const [a, b] = [await ws(), await ws()]
    await gear.createGearItem(db, a, { name: "A's camera" })

    const seenByB = await gear.listGearItems(db, b, { limit: 100, includeDeleted: false })
    expect(seenByB.items).toHaveLength(0)
  })
})

describe('gear on a shoot', () => {
  it('selects a library item and reports its name', async () => {
    const ctx = await ws()
    const shoot = await aShoot(ctx)
    const item = await gear.createGearItem(db, ctx, { name: '85mm f/1.4', category: 'Lens' })

    await gear.addShootGear(db, ctx, { shootId: shoot.id, gearItemId: item.id, quantity: 1 })

    const list = await gear.listShootGear(db, ctx, {
      shootId: shoot.id,
      limit: 100,
      includeDeleted: false,
    })

    // Joined, so the UI does not have to stitch two lists together.
    expect(list.items).toHaveLength(1)
    expect(list.items[0]?.name).toBe('85mm f/1.4')
    expect(list.items[0]?.packed).toBe(false)
  })

  it('treats adding the same item twice as one row', async () => {
    const ctx = await ws()
    const shoot = await aShoot(ctx)
    const item = await gear.createGearItem(db, ctx, { name: 'Tripod' })

    const first = await gear.addShootGear(db, ctx, {
      shootId: shoot.id,
      gearItemId: item.id,
      quantity: 1,
    })
    // Clicking again is not an error. Quantity carries "two of them".
    const second = await gear.addShootGear(db, ctx, {
      shootId: shoot.id,
      gearItemId: item.id,
      quantity: 1,
    })

    expect(second.id).toBe(first.id)
    const list = await gear.listShootGear(db, ctx, {
      shootId: shoot.id,
      limit: 100,
      includeDeleted: false,
    })
    expect(list.items).toHaveLength(1)
  })

  it('restores a previously removed item rather than hiding behind its tombstone', async () => {
    const ctx = await ws()
    const shoot = await aShoot(ctx)
    const item = await gear.createGearItem(db, ctx, { name: 'Reflector' })

    const added = await gear.addShootGear(db, ctx, {
      shootId: shoot.id,
      gearItemId: item.id,
      quantity: 1,
    })
    await gear.removeShootGear(db, ctx, added.id)

    const readded = await gear.addShootGear(db, ctx, {
      shootId: shoot.id,
      gearItemId: item.id,
      quantity: 2,
    })

    expect(readded.deletedAt).toBeNull()
    expect(readded.quantity).toBe(2)
  })

  it('can be marked packed', async () => {
    const ctx = await ws()
    const shoot = await aShoot(ctx)
    const item = await gear.createGearItem(db, ctx, { name: 'Light stand' })
    const added = await gear.addShootGear(db, ctx, {
      shootId: shoot.id,
      gearItemId: item.id,
      quantity: 1,
    })

    const packed = await gear.updateShootGear(db, ctx, { id: added.id, packed: true })
    expect(packed.packed).toBe(true)
  })

  it('refuses a library item from another workspace', async () => {
    const [a, b] = [await ws(), await ws()]
    const shoot = await aShoot(b)
    const foreignItem = await gear.createGearItem(db, a, { name: "A's lens" })

    await expect(
      gear.addShootGear(db, b, {
        shootId: shoot.id,
        gearItemId: foreignItem.id,
        quantity: 1,
      }),
    ).rejects.toThrow(NotFoundError)
  })

  it('keeps shoot selections when a library item is retired', async () => {
    const ctx = await ws()
    const shoot = await aShoot(ctx)
    const item = await gear.createGearItem(db, ctx, { name: 'Old body' })
    await gear.addShootGear(db, ctx, { shootId: shoot.id, gearItemId: item.id, quantity: 1 })

    await gear.deleteGearItem(db, ctx, item.id)

    // Retiring kit must not silently rewrite the packing list of a shoot
    // already planned around it.
    const list = await gear.listShootGear(db, ctx, {
      shootId: shoot.id,
      limit: 100,
      includeDeleted: false,
    })
    expect(list.items).toHaveLength(1)
    expect(list.items[0]?.name).toBe('Old body')
  })
})
