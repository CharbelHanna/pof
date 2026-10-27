import { integer, pgTable, text } from 'drizzle-orm/pg-core'

/**
 * Genres a shoot can be: portrait, editorial, landscape, product.
 *
 * A TABLE rather than a Postgres enum, deliberately — adding a genre is an
 * INSERT, not a migration and a deploy. That is what makes the multi-genre
 * promise real rather than aspirational.
 *
 * ---------------------------------------------------------------------------
 * Deliberately NOT tenant-scoped, and deliberately without a `workspace_id`.
 * ---------------------------------------------------------------------------
 * These are global reference data, like a list of countries: every workspace
 * sees the same four rows and none of them can be edited. There is nothing to
 * isolate, so the table carries no policy and is absent from `tenantTables`.
 *
 * Workspace-defined genres are a later feature. When they arrive they add a
 * nullable `workspace_id` plus a policy of the shape
 * `workspace_id IS NULL OR workspace_id = current_workspace` — a small
 * migration on a four-row table. Adding the column now, with nothing writing
 * to it, would mean a half-built feature and an isolation suite that needs a
 * special case for a table nobody can write to yet.
 *
 * The matching field definitions — the Zod schema and form metadata for each
 * genre's `details` — live in `@pof/schemas` `shoot-types/registry.ts`. This
 * table holds only what the database needs for referential integrity and
 * ordering; it is not a second source of truth for the fields.
 */
export const shootType = pgTable('shoot_type', {
  /** Matches the registry key in @pof/schemas. Referenced by `shoot`. */
  key: text('key').primaryKey(),
  label: text('label').notNull(),
  description: text('description').notNull().default(''),
  /** Display order in pickers. Lower first. */
  sort: integer('sort').notNull().default(0),
})

export type ShootType = typeof shootType.$inferSelect
