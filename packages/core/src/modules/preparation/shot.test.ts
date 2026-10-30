import { createDatabase, type Database } from '@pof/db'
import { testDatabaseUrls } from '@pof/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { NotFoundError, ValidationError } from '../../errors.ts'
import { newWorkspace, sessionWindow } from '../../testing/fixtures.ts'
import * as sessions from '../planning/session.service.ts'
import * as shoots from '../planning/shoot.service.ts'
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

async function shootFor(ctx: Awaited<ReturnType<typeof ws>>, name = 'Shot test shoot') {
  return shoots.createShoot(db, ctx, { name, shootTypeKey: 'portrait', status: 'planning' })
}

describe('createShot', () => {
  it('creates a shot against a shoot', async () => {
    const ctx = await ws()
    const shoot = await shootFor(ctx)

    const created = await shots.createShot(db, ctx, {
      shootId: shoot.id,
      title: 'Wide establishing frame',
      status: 'planned',
    })

    expect(created.title).toBe('Wide establishing frame')
    expect(created.status).toBe('planned')
    expect(created.sessionId).toBeNull()
    expect(created.workspaceId).toBe(ctx.workspaceId)
  })

  it('appends to the running order rather than colliding on position', async () => {
    const ctx = await ws()
    const shoot = await shootFor(ctx)

    const first = await shots.createShot(db, ctx, {
      shootId: shoot.id,
      title: 'First',
      status: 'planned',
    })
    const second = await shots.createShot(db, ctx, {
      shootId: shoot.id,
      title: 'Second',
      status: 'planned',
    })

    expect(second.position).toBeGreaterThan(first.position)
  })

  it('is idempotent when the same client id is replayed', async () => {
    const ctx = await ws()
    const shoot = await shootFor(ctx)
    const id = crypto.randomUUID()

    const first = await shots.createShot(db, ctx, {
      id,
      shootId: shoot.id,
      title: 'Once',
      status: 'planned',
    })
    const second = await shots.createShot(db, ctx, {
      id,
      shootId: shoot.id,
      title: 'Once',
      status: 'planned',
    })

    expect(second.id).toBe(first.id)
    const { items } = await shots.listShots(db, ctx, {
      shootId: shoot.id,
      limit: 50,
      includeDeleted: false,
    })
    expect(items).toHaveLength(1)
  })

  it('rejects a shot on a shoot from another workspace', async () => {
    const mine = await ws()
    const theirs = await ws()
    const theirShoot = await shootFor(theirs)

    await expect(
      shots.createShot(db, mine, {
        shootId: theirShoot.id,
        title: 'Trespassing',
        status: 'planned',
      }),
    ).rejects.toThrow(NotFoundError)
  })

  it('attaches a shot to a session of the same shoot', async () => {
    const ctx = await ws()
    const shoot = await shootFor(ctx)
    const { startsAt, endsAt } = sessionWindow()
    const session = await sessions.createSession(db, ctx, {
      shootId: shoot.id,
      name: 'Golden hour',
      startsAt,
      endsAt,
      timezone: 'UTC',
      status: 'planned',
    })

    const created = await shots.createShot(db, ctx, {
      shootId: shoot.id,
      sessionId: session.id,
      title: 'Session-specific frame',
      status: 'planned',
    })

    expect(created.sessionId).toBe(session.id)
  })
})

describe('listShots', () => {
  it('distinguishes "whole shoot" from "any session"', async () => {
    const ctx = await ws()
    const shoot = await shootFor(ctx)
    const { startsAt, endsAt } = sessionWindow()
    const session = await sessions.createSession(db, ctx, {
      shootId: shoot.id,
      name: 'Session',
      startsAt,
      endsAt,
      timezone: 'UTC',
      status: 'planned',
    })

    await shots.createShot(db, ctx, {
      shootId: shoot.id,
      title: 'Whole shoot',
      status: 'planned',
    })
    await shots.createShot(db, ctx, {
      shootId: shoot.id,
      sessionId: session.id,
      title: 'Just this session',
      status: 'planned',
    })

    // sessionId: null means the shoot-level shots, NOT "no filter".
    const shootLevel = await shots.listShots(db, ctx, {
      shootId: shoot.id,
      sessionId: null,
      limit: 50,
      includeDeleted: false,
    })
    expect(shootLevel.items.map((s) => s.title)).toEqual(['Whole shoot'])

    const sessionLevel = await shots.listShots(db, ctx, {
      shootId: shoot.id,
      sessionId: session.id,
      limit: 50,
      includeDeleted: false,
    })
    expect(sessionLevel.items.map((s) => s.title)).toEqual(['Just this session'])

    // Omitting it entirely returns both.
    const all = await shots.listShots(db, ctx, {
      shootId: shoot.id,
      limit: 50,
      includeDeleted: false,
    })
    expect(all.items).toHaveLength(2)
  })

  it('filters by status', async () => {
    const ctx = await ws()
    const shoot = await shootFor(ctx)

    await shots.createShot(db, ctx, { shootId: shoot.id, title: 'Planned', status: 'planned' })
    await shots.createShot(db, ctx, { shootId: shoot.id, title: 'Captured', status: 'captured' })

    const { items } = await shots.listShots(db, ctx, {
      shootId: shoot.id,
      status: 'captured',
      limit: 50,
      includeDeleted: false,
    })

    expect(items.map((s) => s.title)).toEqual(['Captured'])
  })

  it('hides soft-deleted shots unless asked', async () => {
    const ctx = await ws()
    const shoot = await shootFor(ctx)
    const created = await shots.createShot(db, ctx, {
      shootId: shoot.id,
      title: 'Doomed',
      status: 'planned',
    })

    await shots.deleteShot(db, ctx, created.id)

    const visible = await shots.listShots(db, ctx, {
      shootId: shoot.id,
      limit: 50,
      includeDeleted: false,
    })
    expect(visible.items).toHaveLength(0)

    const withDeleted = await shots.listShots(db, ctx, {
      shootId: shoot.id,
      limit: 50,
      includeDeleted: true,
    })
    expect(withDeleted.items).toHaveLength(1)
  })

  it('does not leak shots across workspaces', async () => {
    const mine = await ws()
    const theirs = await ws()
    const myShoot = await shootFor(mine)
    const theirShoot = await shootFor(theirs)

    await shots.createShot(db, mine, { shootId: myShoot.id, title: 'Mine', status: 'planned' })
    await shots.createShot(db, theirs, {
      shootId: theirShoot.id,
      title: 'Theirs',
      status: 'planned',
    })

    const { items } = await shots.listShots(db, mine, { limit: 50, includeDeleted: false })

    expect(items.map((s) => s.title)).toEqual(['Mine'])
  })
})

describe('reorderShots', () => {
  async function threeShots() {
    const ctx = await ws()
    const shoot = await shootFor(ctx)
    const made = []
    for (const title of ['A', 'B', 'C']) {
      made.push(await shots.createShot(db, ctx, { shootId: shoot.id, title, status: 'planned' }))
    }
    return { ctx, shoot, made }
  }

  async function orderOf(ctx: Awaited<ReturnType<typeof ws>>, shootId: string) {
    const { items } = await shots.listShots(db, ctx, {
      shootId,
      limit: 50,
      includeDeleted: false,
    })
    return items.sort((a, b) => a.position - b.position).map((s) => s.title)
  }

  it('rewrites the running order', async () => {
    const { ctx, shoot, made } = await threeShots()
    expect(await orderOf(ctx, shoot.id)).toEqual(['A', 'B', 'C'])

    await shots.reorderShots(db, ctx, {
      shootId: shoot.id,
      orderedIds: [made[2]!.id, made[0]!.id, made[1]!.id],
    })

    expect(await orderOf(ctx, shoot.id)).toEqual(['C', 'A', 'B'])
  })

  it('rejects a partial list rather than silently interleaving', async () => {
    const { ctx, shoot, made } = await threeShots()

    // Omitting a shot would leave it at a stale position — the drag would
    // look like it "didn't take".
    await expect(
      shots.reorderShots(db, ctx, { shootId: shoot.id, orderedIds: [made[0]!.id, made[1]!.id] }),
    ).rejects.toThrow(ValidationError)

    expect(await orderOf(ctx, shoot.id)).toEqual(['A', 'B', 'C'])
  })

  it('rejects a duplicated id', async () => {
    const { ctx, shoot, made } = await threeShots()

    await expect(
      shots.reorderShots(db, ctx, {
        shootId: shoot.id,
        orderedIds: [made[0]!.id, made[0]!.id, made[1]!.id],
      }),
    ).rejects.toThrow(ValidationError)
  })

  it('rejects a shot belonging to another shoot', async () => {
    const { ctx, shoot, made } = await threeShots()
    const other = await shootFor(ctx, 'Other shoot')
    const foreign = await shots.createShot(db, ctx, {
      shootId: other.id,
      title: 'Elsewhere',
      status: 'planned',
    })

    await expect(
      shots.reorderShots(db, ctx, {
        shootId: shoot.id,
        orderedIds: [made[0]!.id, made[1]!.id, foreign.id],
      }),
    ).rejects.toThrow(NotFoundError)
  })

  it('cannot reorder another workspace’s shoot', async () => {
    const { shoot, made } = await threeShots()
    const stranger = await ws()

    await expect(
      shots.reorderShots(db, stranger, {
        shootId: shoot.id,
        orderedIds: made.map((s) => s.id),
      }),
    ).rejects.toThrow(NotFoundError)
  })
})

describe('updateShot', () => {
  it('marks a shot captured', async () => {
    const ctx = await ws()
    const shoot = await shootFor(ctx)
    const created = await shots.createShot(db, ctx, {
      shootId: shoot.id,
      title: 'To capture',
      status: 'planned',
    })

    const updated = await shots.updateShot(db, ctx, { id: created.id, status: 'captured' })

    expect(updated.status).toBe('captured')
  })

  it('cannot be updated from another workspace', async () => {
    const ctx = await ws()
    const stranger = await ws()
    const shoot = await shootFor(ctx)
    const created = await shots.createShot(db, ctx, {
      shootId: shoot.id,
      title: 'Private',
      status: 'planned',
    })

    await expect(
      shots.updateShot(db, stranger, { id: created.id, title: 'Hijacked' }),
    ).rejects.toThrow(NotFoundError)
  })
})
