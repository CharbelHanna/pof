import { sql } from 'drizzle-orm'

import type { Database } from './client.ts'

/**
 * ===========================================================================
 * The tenant choke point. Every tenant-scoped query in the system goes
 * through this file.
 * ===========================================================================
 *
 * Tenant isolation is enforced in three layers, and this is layer 2:
 *
 *   1. Schema  — every domain table has `workspace_id`, and child tables use
 *                composite (workspace_id, id) foreign keys, so the database
 *                structurally rejects cross-tenant references.
 *   2. HERE    — service code cannot obtain a bare database handle. The only
 *                way to query is `withTenant`, which opens a transaction and
 *                sets the workspace GUC the RLS policies read.
 *   3. RLS     — every domain table has FORCE ROW LEVEL SECURITY with a policy
 *                of `workspace_id = current_setting('app.workspace_id')`.
 *                This is the backstop that catches hand-written SQL which
 *                forgets a filter.
 *
 * Layer 3 exists *because* layer 2 can be bypassed by mistake. Neither is
 * sufficient alone.
 */

/**
 * The verified identity of the caller.
 *
 * `workspaceId` must be the result of a server-side membership lookup. Never
 * build this from `session.activeOrganizationId` without re-checking the
 * `member` table — the client controls that value, and treating it as fact is
 * the easiest cross-tenant read to introduce.
 */
export interface TenantContext {
  readonly workspaceId: string
  readonly userId: string
}

declare const tenantBrand: unique symbol

/**
 * A database handle that has been scoped to one workspace.
 *
 * The brand is a type-level marker: repositories accept `TenantDb` and the
 * only way to obtain one is from `withTenant`, so "I forgot to scope this
 * query" becomes a compile error rather than a data breach.
 */
export type TenantDb = Database & { readonly [tenantBrand]: true }

/**
 * Run `fn` inside a transaction scoped to a single workspace.
 *
 * Implementation notes that are load-bearing, not incidental:
 *
 * - `set_config(..., true)` rather than `SET LOCAL app.workspace_id = ...`.
 *   `SET` cannot take a bind parameter, which would force string interpolation
 *   of a value into SQL. `set_config`'s third argument means "local to this
 *   transaction" and gives the same semantics, safely.
 *
 * - Transaction-local, never session-level. Session-level `SET` breaks under
 *   transaction-mode poolers (PgBouncer and most managed pooled endpoints),
 *   where consecutive statements may land on different backends — the setting
 *   would leak to an unrelated tenant's query or vanish before ours. Keeping
 *   everything inside one explicit transaction is what makes the app safe to
 *   run behind any pooler, which is a portability requirement.
 *
 * - `SET LOCAL ROLE app_user` is defence in depth. The app is supposed to
 *   connect as the unprivileged `app_user` already; this ensures that a
 *   misconfigured DATABASE_URL pointing at the schema owner still runs queries
 *   under a role RLS applies to. (The policies also use FORCE ROW LEVEL
 *   SECURITY, so even the owner is subject to them.)
 */
export async function withTenant<T>(
  db: Database,
  ctx: TenantContext,
  fn: (tx: TenantDb) => Promise<T>,
): Promise<T> {
  if (!ctx.workspaceId) {
    throw new Error('withTenant called without a workspaceId — refusing to run unscoped')
  }

  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.workspace_id', ${ctx.workspaceId}, true)`)
    await tx.execute(sql`set local role app_user`)

    return fn(tx as unknown as TenantDb)
  })
}

/**
 * Escape hatch for work that genuinely spans tenants: the migration runner,
 * the Better Auth adapter, and cross-workspace maintenance jobs.
 *
 * Named to be greppable and uncomfortable. If this appears anywhere inside a
 * domain module, that is a bug — it means a query is running without tenant
 * scoping and RLS is the only thing standing between workspaces.
 */
export function unsafeUnscopedDatabase(db: Database): Database {
  return db
}
