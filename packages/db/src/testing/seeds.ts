import { shoot, type TenantTableName } from '../schema/index.ts'
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
