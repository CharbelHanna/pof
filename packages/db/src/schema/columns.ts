import { sql } from 'drizzle-orm'
import { timestamp, uuid } from 'drizzle-orm/pg-core'

/**
 * Column fragments shared by every domain table.
 *
 * Consistency here is what lets the tenant-isolation suite and the sync layer
 * (`updatedSince` + tombstones) be written once and work for every table,
 * rather than per-table.
 */

/**
 * Audit timestamps present on all domain tables.
 *
 * `updatedAt` is maintained by a database trigger, not by application code —
 * see the `set_updated_at` trigger in the roles/RLS migration. A trigger is
 * used deliberately so that a raw SQL fix applied in psql still advances the
 * value; incremental sync (Phase 8) depends on `updatedAt` never going stale.
 */
export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}

/**
 * Soft delete. User-authored rows are never hard-deleted by normal flows: a
 * deleted row still has to be reported to offline clients as a tombstone so
 * they can drop their local copy. Hard deletion happens only via the GDPR
 * erase job (Phase 7).
 */
export const softDelete = {
  deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
}

/**
 * Primary key for all domain tables.
 *
 * UUIDv7, generated in application code (see `@pof/schemas` `newId()`), not by
 * the database. Two reasons, both load-bearing:
 *
 *  1. Offline clients must be able to mint IDs before they can reach the
 *     server, which makes creates idempotent (`ON CONFLICT (id) DO NOTHING`).
 *  2. v7 is time-ordered, so inserts append to the right-hand edge of the
 *     B-tree instead of scattering like v4 does.
 *
 * Postgres 18 has a native `uuidv7()`, set as the default below purely as a
 * convenience for hand-written SQL. Application code must not rely on it —
 * depending on the database to mint IDs would re-couple us to a PG version and
 * break the offline story.
 */
export const primaryId = () =>
  uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`)

/**
 * The tenant discriminator. Every domain table has one, no exceptions.
 *
 * References `organization.id` — Better Auth's organization table is our
 * workspace, so there is exactly one tenancy root rather than a parallel
 * concept to keep in sync.
 *
 * `onDelete: 'cascade'` means deleting a workspace removes its data in one
 * statement, which the GDPR erase path (Phase 7) relies on.
 */
export const workspaceId = () => uuid('workspace_id').notNull()
