import {
  gearItem,
  location,
  shoot,
  shootSession,
  shot,
  type TenantTableName,
} from '../schema/index.ts'
import type { TenantDb } from '../tenant.ts'

/**
 * A minimal valid row for each tenant-scoped table, used by the isolation
 * suite as a probe.
 *
 * This is a `Record` over `TenantTableName` on purpose: registering a new
 * domain table in `tenantTables` without adding a seed here is a COMPILE
 * error. That is the mechanism that stops a table from quietly shipping
 * without anyone proving it is isolated.
 *
 * Seeds receive the scoped transaction as well as the workspace id, because
 * some tables need a parent row first — a session cannot exist without a
 * shoot. Creating that parent through the same `tx` is deliberate: it means
 * the prerequisite is subject to the very policies under test, so a seed
 * cannot accidentally set up state the application itself could not.
 */
export type TenantSeed = (workspaceId: string, tx: TenantDb) => Promise<Record<string, unknown>>

export const tenantSeeds: Record<TenantTableName, TenantSeed> = {
  shoot: async (workspaceId) => ({ workspaceId, name: 'isolation probe' }),

  campaign: async (workspaceId) => ({ workspaceId, name: 'isolation probe campaign' }),

  crewMember: async (workspaceId, tx) => {
    const [parent] = await tx
      .insert(shoot)
      .values({ workspaceId, name: 'isolation probe crew parent' })
      .returning({ id: shoot.id })

    return { workspaceId, shootId: parent!.id, role: 'assistant' }
  },

  gearItem: async (workspaceId) => ({ workspaceId, name: 'isolation probe gear' }),

  location: async (workspaceId) => ({
    workspaceId,
    name: 'isolation probe location',
    latitude: 56.6667,
    longitude: -5.1,
  }),

  shootGear: async (workspaceId, tx) => {
    const [parent] = await tx
      .insert(shoot)
      .values({ workspaceId, name: 'isolation probe gear parent' })
      .returning({ id: shoot.id })

    const [item] = await tx
      .insert(gearItem)
      .values({ workspaceId, name: 'isolation probe library item' })
      .returning({ id: gearItem.id })

    return { workspaceId, shootId: parent!.id, gearItemId: item!.id }
  },

  shot: async (workspaceId, tx) => {
    const [parent] = await tx
      .insert(shoot)
      .values({ workspaceId, name: 'isolation probe shot parent' })
      .returning({ id: shoot.id })

    return { workspaceId, shootId: parent!.id, title: 'isolation probe shot' }
  },

  shotGearRequirement: async (workspaceId, tx) => {
    const [parent] = await tx
      .insert(shoot)
      .values({ workspaceId, name: 'isolation probe requirement parent' })
      .returning({ id: shoot.id })

    const [frame] = await tx
      .insert(shot)
      .values({ workspaceId, shootId: parent!.id, title: 'isolation probe requirement shot' })
      .returning({ id: shot.id })

    const [item] = await tx
      .insert(gearItem)
      .values({ workspaceId, name: 'isolation probe required item' })
      .returning({ id: gearItem.id })

    return { workspaceId, shotId: frame!.id, gearItemId: item!.id }
  },

  sessionLocation: async (workspaceId, tx) => {
    const [parent] = await tx
      .insert(shoot)
      .values({ workspaceId, name: 'isolation probe route parent' })
      .returning({ id: shoot.id })

    const [session] = await tx
      .insert(shootSession)
      .values({
        workspaceId,
        shootId: parent!.id,
        name: 'isolation probe route session',
        startsAt: new Date('2026-11-01T09:00:00.000Z'),
        endsAt: new Date('2026-11-01T11:00:00.000Z'),
      })
      .returning({ id: shootSession.id })

    const [place] = await tx
      .insert(location)
      .values({
        workspaceId,
        name: 'isolation probe stop',
        latitude: 56.6667,
        longitude: -5.1,
      })
      .returning({ id: location.id })

    return { workspaceId, sessionId: session!.id, locationId: place!.id }
  },

  shootSession: async (workspaceId, tx) => {
    const [parent] = await tx
      .insert(shoot)
      .values({ workspaceId, name: 'isolation probe parent' })
      .returning({ id: shoot.id })

    const startsAt = new Date('2026-11-01T09:00:00.000Z')

    return {
      workspaceId,
      shootId: parent!.id,
      name: 'isolation probe session',
      startsAt,
      // Must be after startsAt — there is a CHECK constraint enforcing it.
      endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
    }
  },
}
