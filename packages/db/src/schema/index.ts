/**
 * The complete Drizzle schema.
 *
 * Two deliberately separate groups:
 *
 *  - `./auth.ts`      — Better Auth's tables. Not tenant-scoped, no RLS. Auth
 *                       must resolve a user before any workspace exists.
 *  - `./domain/*`     — our tables. Every one carries `workspace_id`, is
 *                       RLS-forced, and is only reachable through `withTenant`.
 *
 * `tenantTables` below drives the tenant-isolation test suite. Adding a domain
 * table without registering it here makes that suite fail — which is the point.
 */

export * from './auth.ts'
export * from './domain/shoot.ts'

import { shoot } from './domain/shoot.ts'

/**
 * Every workspace-scoped table, keyed by table name.
 *
 * The isolation suite iterates this map, seeds a row for two tenants, and
 * asserts each tenant can see exactly its own and cannot read, update or
 * delete the other's. Register every new domain table here.
 */
export const tenantTables = {
  shoot,
} as const

export type TenantTableName = keyof typeof tenantTables
