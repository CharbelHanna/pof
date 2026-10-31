import { createDatabase, type Database } from '@pof/db'
import { testDatabaseUrls } from '@pof/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { NotFoundError, ValidationError } from '../../errors.ts'
import { newWorkspace, sessionWindow } from '../../testing/fixtures.ts'
import * as sessions from '../planning/session.service.ts'
import * as shoots from '../planning/shoot.service.ts'
import * as locations from './location.service.ts'
import * as sessionLocations from './session-location.service.ts'

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

/** A shoot with one session, plus a saved place — the setup every test needs. */
async function scene(ctx: Awaited<ReturnType<typeof ws>>) {
  const shoot = await shoots.createShoot(db, ctx, {
    name: 'Glen Coe sunrise',
    shootTypeKey: 'landscape',
    status: 'planning',
  })
  const { startsAt, endsAt } = sessionWindow()
  const session = await sessions.createSession(db, ctx, {
    shootId: shoot.id,
    name: 'Sunrise',
    startsAt,
    endsAt,
    timezone: 'Europe/London',
    status: 'planned',
  })
  const place = await locations.createLocation(db, ctx, {
    name: 'Lochside',
    latitude: 56.6667,
    longitude: -5.1,
  })

  return { shoot, session, place }
}

describe('addSessionLocation', () => {
  it('adds a stop to a session', async () => {
    const ctx = await ws()
    const { session, place } = await scene(ctx)

    const stop = await sessionLocations.addSessionLocation(db, ctx, {
      sessionId: session.id,
      locationId: place.id,
      notes: 'park at the layby',
    })

    expect(stop.sessionId).toBe(session.id)
    expect(stop.locationId).toBe(place.id)
    expect(stop.notes).toBe('park at the layby')
    expect(stop.workspaceId).toBe(ctx.workspaceId)
  })

  /** The whole point of the change: one session, several places. */
  it('accepts several stops and appends them in order', async () => {
    const ctx = await ws()
    const { session, place } = await scene(ctx)
    const ridge = await locations.createLocation(db, ctx, {
      name: 'Ridge',
      latitude: 56.67,
      longitude: -5.09,
    })

    const first = await sessionLocations.addSessionLocation(db, ctx, {
      sessionId: session.id,
      locationId: place.id,
    })
    const second = await sessionLocations.addSessionLocation(db, ctx, {
      sessionId: session.id,
      locationId: ridge.id,
    })

    expect(second.position).toBeGreaterThan(first.position)

    const { items } = await sessionLocations.listSessionLocations(db, ctx, {
      sessionId: session.id,
      limit: 50,
      includeDeleted: false,
    })
    expect(items).toHaveLength(2)
  })

  /** The other direction, which already worked and must keep working. */
  it('allows one location to be used by several sessions', async () => {
    const ctx = await ws()
    const { shoot, session, place } = await scene(ctx)
    const { startsAt, endsAt } = sessionWindow(24)
    const second = await sessions.createSession(db, ctx, {
      shootId: shoot.id,
      name: 'Next morning',
      startsAt,
      endsAt,
      timezone: 'Europe/London',
      status: 'planned',
    })

    await sessionLocations.addSessionLocation(db, ctx, {
      sessionId: session.id,
      locationId: place.id,
    })
    await sessionLocations.addSessionLocation(db, ctx, {
      sessionId: second.id,
      locationId: place.id,
    })

    const a = await sessionLocations.listSessionLocations(db, ctx, {
      sessionId: session.id,
      limit: 50,
      includeDeleted: false,
    })
    const b = await sessionLocations.listSessionLocations(db, ctx, {
      sessionId: second.id,
      limit: 50,
      includeDeleted: false,
    })

    expect(a.items).toHaveLength(1)
    expect(b.items).toHaveLength(1)
  })

  it('returns the existing row when the same stop is added twice', async () => {
    const ctx = await ws()
    const { session, place } = await scene(ctx)

    const first = await sessionLocations.addSessionLocation(db, ctx, {
      sessionId: session.id,
      locationId: place.id,
    })
    const again = await sessionLocations.addSessionLocation(db, ctx, {
      sessionId: session.id,
      locationId: place.id,
    })

    expect(again.id).toBe(first.id)
  })

  it('rejects a session from another workspace', async () => {
    const mine = await ws()
    const theirs = await ws()
    const { session } = await scene(theirs)
    const myPlace = await locations.createLocation(db, mine, {
      name: 'Mine',
      latitude: 51.5,
      longitude: -0.1,
    })

    await expect(
      sessionLocations.addSessionLocation(db, mine, {
        sessionId: session.id,
        locationId: myPlace.id,
      }),
    ).rejects.toThrow(NotFoundError)
  })

  it('rejects a location from another workspace', async () => {
    const mine = await ws()
    const theirs = await ws()
    const { session } = await scene(mine)
    const theirPlace = await locations.createLocation(db, theirs, {
      name: 'Theirs',
      latitude: 51.5,
      longitude: -0.1,
    })

    await expect(
      sessionLocations.addSessionLocation(db, mine, {
        sessionId: session.id,
        locationId: theirPlace.id,
      }),
    ).rejects.toThrow(NotFoundError)
  })
})

describe('reorderSessionLocations', () => {
  async function route() {
    const ctx = await ws()
    const { session } = await scene(ctx)
    const made = []
    for (const name of ['Layby', 'Lochside', 'Ridge']) {
      const place = await locations.createLocation(db, ctx, {
        name,
        latitude: 56.6,
        longitude: -5.1,
      })
      made.push(
        await sessionLocations.addSessionLocation(db, ctx, {
          sessionId: session.id,
          locationId: place.id,
        }),
      )
    }
    return { ctx, session, made }
  }

  async function orderOf(ctx: Awaited<ReturnType<typeof ws>>, sessionId: string) {
    const { items } = await sessionLocations.listSessionLocations(db, ctx, {
      sessionId,
      limit: 50,
      includeDeleted: false,
    })
    return items.sort((a, b) => a.position - b.position).map((stop) => stop.id)
  }

  it('rewrites the visiting order', async () => {
    const { ctx, session, made } = await route()
    expect(await orderOf(ctx, session.id)).toEqual(made.map((s) => s.id))

    await sessionLocations.reorderSessionLocations(db, ctx, {
      sessionId: session.id,
      orderedIds: [made[2]!.id, made[0]!.id, made[1]!.id],
    })

    expect(await orderOf(ctx, session.id)).toEqual([made[2]!.id, made[0]!.id, made[1]!.id])
  })

  it('rejects a partial list rather than silently interleaving', async () => {
    const { ctx, session, made } = await route()

    await expect(
      sessionLocations.reorderSessionLocations(db, ctx, {
        sessionId: session.id,
        orderedIds: [made[0]!.id, made[1]!.id],
      }),
    ).rejects.toThrow(ValidationError)

    expect(await orderOf(ctx, session.id)).toEqual(made.map((s) => s.id))
  })

  it('rejects a duplicated id', async () => {
    const { ctx, session, made } = await route()

    await expect(
      sessionLocations.reorderSessionLocations(db, ctx, {
        sessionId: session.id,
        orderedIds: [made[0]!.id, made[0]!.id, made[1]!.id],
      }),
    ).rejects.toThrow(ValidationError)
  })

  it('cannot reorder another workspace’s session', async () => {
    const { session, made } = await route()
    const stranger = await ws()

    await expect(
      sessionLocations.reorderSessionLocations(db, stranger, {
        sessionId: session.id,
        orderedIds: made.map((s) => s.id),
      }),
    ).rejects.toThrow(NotFoundError)
  })
})

describe('removeSessionLocation', () => {
  it('soft-deletes and hides from the default list', async () => {
    const ctx = await ws()
    const { session, place } = await scene(ctx)
    const stop = await sessionLocations.addSessionLocation(db, ctx, {
      sessionId: session.id,
      locationId: place.id,
    })

    await sessionLocations.removeSessionLocation(db, ctx, stop.id)

    const visible = await sessionLocations.listSessionLocations(db, ctx, {
      sessionId: session.id,
      limit: 50,
      includeDeleted: false,
    })
    expect(visible.items).toHaveLength(0)

    const withDeleted = await sessionLocations.listSessionLocations(db, ctx, {
      sessionId: session.id,
      limit: 50,
      includeDeleted: true,
    })
    expect(withDeleted.items).toHaveLength(1)
  })

  it('removing a stop leaves the saved location itself alone', async () => {
    const ctx = await ws()
    const { session, place } = await scene(ctx)
    const stop = await sessionLocations.addSessionLocation(db, ctx, {
      sessionId: session.id,
      locationId: place.id,
    })

    await sessionLocations.removeSessionLocation(db, ctx, stop.id)

    // The library of places is reusable; dropping it from one route must not
    // delete it from the workspace.
    const still = await locations.getLocation(db, ctx, place.id)
    expect(still.id).toBe(place.id)
    expect(still.deletedAt).toBeNull()
  })
})

describe('listSessionLocations', () => {
  it('does not leak across workspaces', async () => {
    const mine = await ws()
    const theirs = await ws()
    const a = await scene(mine)
    const b = await scene(theirs)

    await sessionLocations.addSessionLocation(db, mine, {
      sessionId: a.session.id,
      locationId: a.place.id,
    })
    await sessionLocations.addSessionLocation(db, theirs, {
      sessionId: b.session.id,
      locationId: b.place.id,
    })

    const { items } = await sessionLocations.listSessionLocations(db, mine, {
      limit: 50,
      includeDeleted: false,
    })

    expect(items).toHaveLength(1)
    expect(items[0]!.sessionId).toBe(a.session.id)
  })
})
