import { createDatabase, type Database } from '@pof/db'
import { testDatabaseUrls } from '@pof/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { newWorkspace } from '../../testing/fixtures.ts'
import * as locations from './location.service.ts'

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

/** A geocoder result, as the picker would pass it on. */
const glenCoe = {
  name: 'Glen Coe',
  address: 'Glen Coe, Highland, Scotland',
  latitude: 56.6667,
  longitude: -5.1,
  provider: 'osm',
  providerId: 'W26809942',
  permitRequired: false,
}

describe('createLocation', () => {
  /**
   * The bug this file exists for.
   *
   * The picker mints a fresh id for every selection, and the insert only
   * guarded the primary key — so choosing the same search result twice made
   * two rows. The dropdown then listed the same place repeatedly with
   * nothing to tell the copies apart.
   */
  it('returns the same row when the same place is saved twice', async () => {
    const ctx = await ws()

    const first = await locations.createLocation(db, ctx, { id: crypto.randomUUID(), ...glenCoe })
    const second = await locations.createLocation(db, ctx, { id: crypto.randomUUID(), ...glenCoe })

    expect(second.id).toBe(first.id)

    const { items } = await locations.listLocations(db, ctx, {
      limit: 50,
      includeDeleted: false,
    })
    expect(items).toHaveLength(1)
  })

  it('still replays an identical id to the same row', async () => {
    const ctx = await ws()
    const id = crypto.randomUUID()

    const first = await locations.createLocation(db, ctx, { id, ...glenCoe })
    const second = await locations.createLocation(db, ctx, { id, ...glenCoe })

    expect(second.id).toBe(first.id)
  })

  it('keeps two different places apart', async () => {
    const ctx = await ws()

    await locations.createLocation(db, ctx, { id: crypto.randomUUID(), ...glenCoe })
    await locations.createLocation(db, ctx, {
      id: crypto.randomUUID(),
      ...glenCoe,
      name: 'Rannoch Moor',
      providerId: 'W12345678',
    })

    const { items } = await locations.listLocations(db, ctx, {
      limit: 50,
      includeDeleted: false,
    })
    expect(items).toHaveLength(2)
  })

  /**
   * A hand-typed location has no provider id, and those must be free to
   * repeat — two studios may legitimately share a name. This is why the
   * unique index is partial rather than covering every row.
   */
  it('allows repeats for locations with no provider id', async () => {
    const ctx = await ws()
    const manual = {
      name: 'My Studio',
      latitude: 51.5,
      longitude: -0.1,
      permitRequired: false,
    }

    await locations.createLocation(db, ctx, { id: crypto.randomUUID(), ...manual })
    await locations.createLocation(db, ctx, { id: crypto.randomUUID(), ...manual })

    const { items } = await locations.listLocations(db, ctx, {
      limit: 50,
      includeDeleted: false,
    })
    expect(items).toHaveLength(2)
  })

  /**
   * Soft deletes exist for sync, not to reserve names. If a tombstone kept
   * occupying the slot, deleting a place would permanently bar re-adding it.
   */
  it('lets a deleted place be saved again', async () => {
    const ctx = await ws()

    const first = await locations.createLocation(db, ctx, { id: crypto.randomUUID(), ...glenCoe })
    await locations.deleteLocation(db, ctx, first.id)

    const again = await locations.createLocation(db, ctx, { id: crypto.randomUUID(), ...glenCoe })

    expect(again.id).not.toBe(first.id)

    const { items } = await locations.listLocations(db, ctx, {
      limit: 50,
      includeDeleted: false,
    })
    expect(items).toHaveLength(1)
  })

  it('does not merge the same place across workspaces', async () => {
    const mine = await ws()
    const theirs = await ws()

    const a = await locations.createLocation(db, mine, { id: crypto.randomUUID(), ...glenCoe })
    const b = await locations.createLocation(db, theirs, { id: crypto.randomUUID(), ...glenCoe })

    // Each workspace keeps its own copy, with its own access notes and
    // permit flags. Sharing one row would leak edits between tenants.
    expect(b.id).not.toBe(a.id)
  })
})
