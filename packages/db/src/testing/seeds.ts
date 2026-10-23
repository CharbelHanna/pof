import type { TenantTableName } from '../schema/index.ts'

/**
 * A minimal valid row for each tenant-scoped table, used by the isolation
 * suite as a probe.
 *
 * This is a `Record` over `TenantTableName` on purpose: registering a new
 * domain table in `tenantTables` without adding a seed here is a COMPILE
 * error. That is the mechanism that stops a table from quietly shipping
 * without anyone proving it is isolated.
 */
export const tenantSeeds: Record<
  TenantTableName,
  (workspaceId: string) => Record<string, unknown>
> = {
  shoot: (workspaceId) => ({ workspaceId, name: 'isolation probe' }),
}
