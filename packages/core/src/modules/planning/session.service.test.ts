import { createDatabase, type Database } from '@pof/db'
import { testDatabaseUrls } from '@pof/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { NotFoundError, ValidationError } from '../../errors.ts'
import { newWorkspace, sessionWindow } from '../../testing/fixtures.ts'
import * as sessions from './session.service.ts'
import * as shoots from './shoot.service.ts'

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

async function shootIn(ctx: Awaited<ReturnType<typeof ws>>, name = 'Parent shoot') {
  return shoots.createShoot(db, ctx, { name, shootTypeKey: 'portrait', status: 'draft' })
}

describe('createSession', () => {
  it('creates a session under a shoot', async () => {
    const ctx = await ws()
    const shoot = await shootIn(ctx)
    const { startsAt, endsAt } = sessionWindow()

    const created = await sessions.createSession(db, ctx, {
      shootId: shoot.id,
      name: 'Golden hour',
      status: 'planned',
      startsAt,
      endsAt,
      timezone: 'Europe/London',
    })

    expect(created.shootId).toBe(shoot.id)
    expect(created.timezone).toBe('Europe/London')
    expect(created.startsAt.toISOString()).toBe(startsAt.toISOString())
  })

  it('refuses a session on a shoot in another workspace', async () => {
    const [a, b] = [await ws(), await ws()]
    const foreign = await shootIn(a)
    const { startsAt, endsAt } = sessionWindow()

    await expect(
      sessions.createSession(db, b, {
        shootId: foreign.id,
        name: 'Sneaky',
        status: 'planned',
        startsAt,
        endsAt,
        timezone: 'UTC',
      }),
    ).rejects.toThrow(NotFoundError)
  })

  it('refuses a session on a deleted shoot', async () => {
    const ctx = await ws()
    const shoot = await shootIn(ctx)
    await shoots.deleteShoot(db, ctx, shoot.id)
    const { startsAt, endsAt } = sessionWindow()

    await expect(
      sessions.createSession(db, ctx, {
        shootId: shoot.id,
        name: 'Too late',
        status: 'planned',
        startsAt,
        endsAt,
        timezone: 'UTC',
      }),
    ).rejects.toThrow(ValidationError)
  })

  it('preserves the exact instant across timezones', async () => {
    const ctx = await ws()
    const shoot = await shootIn(ctx)

    // 06:00 in London on a summer date is 05:00 UTC — the zone is stored
    // alongside so the call time can be rendered as 06:00 regardless of who
    // is looking, and survives the DST change between planning and shooting.
    const startsAt = new Date('2027-06-21T05:00:00.000Z')
    const created = await sessions.createSession(db, ctx, {
      shootId: shoot.id,
      name: 'Sunrise',
      status: 'planned',
      startsAt,
      endsAt: new Date('2027-06-21T07:00:00.000Z'),
      timezone: 'Europe/London',
    })

    const readBack = await sessions.getSession(db, ctx, created.id)
    expect(readBack.startsAt.toISOString()).toBe('2027-06-21T05:00:00.000Z')

    const localHour = new Intl.DateTimeFormat('en-GB', {
      timeZone: readBack.timezone,
      hour: '2-digit',
      hour12: false,
    }).format(readBack.startsAt)
    expect(localHour).toBe('06')
  })
})

describe('session time ordering', () => {
  it('rejects an end before the start at the database level', async () => {
    const ctx = await ws()
    const shoot = await shootIn(ctx)
    const { startsAt } = sessionWindow()

    // The input schema also catches this; here the service is handed values
    // that bypass it, to prove the CHECK constraint is really there.
    await expect(
      sessions.createSession(db, ctx, {
        shootId: shoot.id,
        name: 'Backwards',
        status: 'planned',
        startsAt,
        endsAt: new Date(startsAt.getTime() - 60_000),
        timezone: 'UTC',
      }),
    ).rejects.toThrow()
  })

  it('rejects a partial update that would invert the times', async () => {
    const ctx = await ws()
    const shoot = await shootIn(ctx)
    const { startsAt, endsAt } = sessionWindow()
    const created = await sessions.createSession(db, ctx, {
      shootId: shoot.id,
      name: 'Movable',
      status: 'planned',
      startsAt,
      endsAt,
      timezone: 'UTC',
    })

    // Only `startsAt` is supplied, and on its own it is perfectly valid —
    // the conflict only exists against the stored `endsAt`. This is the case
    // a field-level schema cannot catch.
    await expect(
      sessions.updateSession(db, ctx, {
        id: created.id,
        startsAt: new Date(endsAt.getTime() + 60 * 60 * 1000),
      }),
    ).rejects.toThrow(ValidationError)
  })

  it('allows a valid partial move', async () => {
    const ctx = await ws()
    const shoot = await shootIn(ctx)
    const { startsAt, endsAt } = sessionWindow()
    const created = await sessions.createSession(db, ctx, {
      shootId: shoot.id,
      name: 'Movable',
      status: 'planned',
      startsAt,
      endsAt,
      timezone: 'UTC',
    })

    const moved = await sessions.updateSession(db, ctx, {
      id: created.id,
      endsAt: new Date(endsAt.getTime() + 60 * 60 * 1000),
    })

    expect(moved.endsAt.getTime()).toBe(endsAt.getTime() + 60 * 60 * 1000)
  })
})

describe('listSessions', () => {
  it('filters to one shoot', async () => {
    const ctx = await ws()
    const [first, second] = [await shootIn(ctx, 'First'), await shootIn(ctx, 'Second')]

    for (const [index, shoot] of [first, second].entries()) {
      const { startsAt, endsAt } = sessionWindow(index)
      await sessions.createSession(db, ctx, {
        shootId: shoot.id,
        name: `Session ${index}`,
        status: 'planned',
        startsAt,
        endsAt,
        timezone: 'UTC',
      })
    }

    const onlyFirst = await sessions.listSessions(db, ctx, {
      shootId: first.id,
      limit: 100,
      includeDeleted: false,
    })

    expect(onlyFirst.items).toHaveLength(1)
    expect(onlyFirst.items[0]?.shootId).toBe(first.id)
  })

  it('filters by a date window, which the calendar view depends on', async () => {
    const ctx = await ws()
    const shoot = await shootIn(ctx)

    const early = sessionWindow(0)
    const late = sessionWindow(72)
    for (const [name, window] of [
      ['Early', early],
      ['Late', late],
    ] as const) {
      await sessions.createSession(db, ctx, {
        shootId: shoot.id,
        name,
        status: 'planned',
        startsAt: window.startsAt,
        endsAt: window.endsAt,
        timezone: 'UTC',
      })
    }

    const window = await sessions.listSessions(db, ctx, {
      from: new Date(early.startsAt.getTime() - 60_000),
      until: new Date(early.startsAt.getTime() + 60_000),
      limit: 100,
      includeDeleted: false,
    })

    expect(window.items.map((s) => s.name)).toEqual(['Early'])
  })

  it('hides sessions belonging to another workspace', async () => {
    const [a, b] = [await ws(), await ws()]
    const shoot = await shootIn(a)
    const { startsAt, endsAt } = sessionWindow()
    await sessions.createSession(db, a, {
      shootId: shoot.id,
      name: 'Private',
      status: 'planned',
      startsAt,
      endsAt,
      timezone: 'UTC',
    })

    const seenByB = await sessions.listSessions(db, b, { limit: 100, includeDeleted: false })
    expect(seenByB.items).toHaveLength(0)
  })
})

describe('deleting a shoot', () => {
  it('leaves its sessions reachable as tombstones', async () => {
    const ctx = await ws()
    const shoot = await shootIn(ctx)
    const { startsAt, endsAt } = sessionWindow()
    await sessions.createSession(db, ctx, {
      shootId: shoot.id,
      name: 'Child',
      status: 'planned',
      startsAt,
      endsAt,
      timezone: 'UTC',
    })

    // The shoot is soft-deleted, so the row survives and the composite
    // foreign key's CASCADE never fires. Sessions are not themselves marked
    // deleted — worth pinning, because it is the behaviour the shoot detail
    // view and an undelete would both depend on.
    await shoots.deleteShoot(db, ctx, shoot.id)

    const remaining = await sessions.listSessions(db, ctx, {
      shootId: shoot.id,
      limit: 100,
      includeDeleted: false,
    })
    expect(remaining.items).toHaveLength(1)
  })
})
