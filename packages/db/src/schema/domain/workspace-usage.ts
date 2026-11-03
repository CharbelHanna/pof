import { bigint, integer, pgTable, uuid } from 'drizzle-orm/pg-core'

import { organization } from '../auth.ts'
import { timestamps } from '../columns.ts'

/**
 * What a workspace is consuming.
 *
 * One row per workspace — `workspace_id` is the primary key, so there is no
 * separate `id` and nothing to soft-delete. The row is created on first use
 * rather than with the workspace, so a workspace that has never uploaded
 * carries nothing.
 *
 * ---------------------------------------------------------------------------
 * Why a counter rather than a query
 * ---------------------------------------------------------------------------
 * `SUM(bytes)` over the asset table would be correct and is cheap at this
 * size. The counter exists because the entitlement seam
 * (`identity/entitlements.ts`) is meant to be consulted on every upload, and
 * a limit check that scans every asset a workspace owns gets slower exactly
 * as a workspace becomes more valuable.
 *
 * It is maintained as a DELTA computed inside the same transaction that
 * changes an asset, never as an absolute figure written from outside. That
 * is what makes it safe under retries: a reprocessed asset contributes
 * `new - old`, which is zero when nothing actually changed.
 *
 * It remains reconstructible from `asset` if it ever drifts, which is the
 * property that makes the optimisation reversible rather than a commitment.
 */
export const workspaceUsage = pgTable('workspace_usage', {
  workspaceId: uuid('workspace_id')
    .primaryKey()
    .references(() => organization.id, { onDelete: 'cascade' }),

  /**
   * Bytes held in object storage: originals plus every derivative.
   *
   * `bigint` rather than `integer` — a workspace with a few thousand raw
   * files passes 2GB, and silently wrapping a storage figure is the kind of
   * bug that only shows up on the biggest customer.
   */
  storageBytes: bigint('storage_bytes', { mode: 'number' }).notNull().default(0),

  /** Assets whose bytes are actually in storage, so `pending` rows are not counted. */
  assetCount: integer('asset_count').notNull().default(0),

  ...timestamps,
})

export type WorkspaceUsage = typeof workspaceUsage.$inferSelect
export type NewWorkspaceUsage = typeof workspaceUsage.$inferInsert
