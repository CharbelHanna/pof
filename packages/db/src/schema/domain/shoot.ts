import { index, pgEnum, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core'

import { primaryId, softDelete, timestamps, workspaceId } from '../columns.ts'
import { organization } from '../auth.ts'

/**
 * Shoot — the aggregate root of the planning domain.
 *
 * A shoot is one photoshoot: it owns sessions, shot lists, checklists,
 * moodboards and deliverables. Its parent campaign is optional (Phase 1), so a
 * landscape photographer planning a single sunrise shoot is never forced to
 * invent a campaign first.
 */

/**
 * Lifecycle status.
 *
 * A Postgres enum is appropriate *here* — these five values are cross-genre and
 * stable, and the application branches on them. Contrast with shoot *type*
 * (portrait / editorial / landscape / product), which is a seeded reference
 * table precisely because adding a genre must not require a migration.
 */
export const shootStatus = pgEnum('shoot_status', [
  'draft',
  'planning',
  'confirmed',
  'shooting',
  'completed',
  'cancelled',
])

export const shoot = pgTable(
  'shoot',
  {
    id: primaryId(),

    /**
     * Tenant discriminator. Present on every domain table, no exceptions.
     * The RLS policy in the roles migration keys off this column.
     */
    workspaceId: workspaceId().references(() => organization.id, { onDelete: 'cascade' }),

    name: text('name').notNull(),

    /**
     * References `shoot_type.key` from Phase 1 onward. Deliberately a plain
     * text key rather than an enum so that adding a genre is an INSERT, not a
     * migration and deploy.
     */
    shootTypeKey: text('shoot_type_key').notNull().default('portrait'),

    status: shootStatus('status').notNull().default('draft'),

    notes: text('notes'),

    ...timestamps,
    ...softDelete,
  },
  (table) => [
    /**
     * The composite uniqueness that makes cross-tenant FKs structurally
     * impossible. Child tables (session, shot_list, checklist, moodboard,
     * deliverable — Phases 1-3) reference (workspace_id, shoot_id) against
     * this constraint rather than referencing `id` alone, so the database
     * itself rejects attaching workspace A's session to workspace B's shoot.
     * Nothing is relying on it yet; it exists so Phase 1 can.
     */
    unique('shoot_workspace_id_id_key').on(table.workspaceId, table.id),

    /**
     * Supports the default list view (a workspace's shoots, newest first) and
     * the `updatedSince` incremental-sync query the mobile app will use.
     */
    index('shoot_workspace_updated_idx').on(table.workspaceId, table.updatedAt),
  ],
)

export type Shoot = typeof shoot.$inferSelect
export type NewShoot = typeof shoot.$inferInsert
