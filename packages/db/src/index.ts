/**
 * @pof/db public surface.
 *
 * Note what is NOT exported: a ready-to-use database handle. Domain code gets
 * at the database only via `withTenant`, which guarantees a workspace-scoped
 * transaction. See ./tenant.ts for why that matters.
 */

export { withTenant, unsafeUnscopedDatabase } from './tenant.ts'
export type { TenantContext, TenantDb } from './tenant.ts'

export { createDatabase, sharedDatabase, closeSharedDatabase } from './client.ts'
export type { Database } from './client.ts'

export * as schema from './schema/index.ts'
export { tenantTables, authTables, authTableNames } from './schema/index.ts'
export type { TenantTableName } from './schema/index.ts'
export type { Shoot, NewShoot } from './schema/index.ts'
