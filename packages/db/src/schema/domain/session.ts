import {
  check,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

import { organization } from '../auth.ts'
import { primaryId, softDelete, timestamps, workspaceId } from '../columns.ts'
import { shoot } from './shoot.ts'

/**
 * Session — a single block of shooting time within a shoot.
 *
 * A shoot might be one session (a morning in the studio) or several (a studio
 * day plus a rooftop golden hour). Templates are applied per session, which is
 * why this is the unit rather than the shoot.
 */

export const sessionStatus = pgEnum('session_status', [
  'planned',
  'confirmed',
  'in_progress',
  'completed',
  'cancelled',
])

export const shootSession = pgTable(
  'shoot_session',
  {
    id: primaryId(),
    workspaceId: workspaceId().references(() => organization.id, { onDelete: 'cascade' }),

    shootId: uuid('shoot_id').notNull(),

    name: text('name').notNull(),
    status: sessionStatus('status').notNull().default('planned'),
    notes: text('notes'),

    /**
     * The instant the session starts, stored as timestamptz — an absolute
     * moment, independent of who is looking at it.
     */
    startsAt: timestamp('starts_at', { withTimezone: true, mode: 'date' }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true, mode: 'date' }).notNull(),

    /**
     * The IANA zone the session happens IN — not the photographer's current
     * zone, and not the viewer's.
     *
     * Storing the instant alone is not enough. "Call time 06:00 at Glen Coe"
     * has to keep reading as 06:00 when planned from another country, and has
     * to survive a DST transition between planning and shooting. Rendering
     * `starts_at` in the viewer's local zone would quietly show the wrong
     * hour for exactly the shoots where the hour matters most — a sunrise
     * landscape call.
     */
    timezone: text('timezone').notNull().default('UTC'),

    ...timestamps,
    ...softDelete,
  },
  (table) => [
    /**
     * COMPOSITE foreign key — the structural half of tenant isolation.
     *
     * Referencing `(workspace_id, shoot_id)` against `shoot (workspace_id,
     * id)` rather than `shoot_id` alone makes it impossible for the database
     * to accept a session attached to another workspace's shoot. Application
     * bugs and hand-written SQL are both covered, because the constraint is in
     * the schema rather than in a query.
     */
    foreignKey({
      columns: [table.workspaceId, table.shootId],
      foreignColumns: [shoot.workspaceId, shoot.id],
      name: 'shoot_session_shoot_fk',
    }).onDelete('cascade'),

    unique('shoot_session_workspace_id_id_key').on(table.workspaceId, table.id),

    /**
     * Target for composite foreign keys that need a session to belong to a
     * specific SHOOT, not merely to the same workspace — crew assigned to one
     * session of a shoot, and the shot lists and checklists of later phases.
     * Without `shoot_id` in the key, those references could point at a
     * session of a different shoot in the same workspace.
     */
    unique('shoot_session_workspace_shoot_id_key').on(table.workspaceId, table.shootId, table.id),

    // Supports the shoot detail view and `updatedSince` incremental sync.
    index('shoot_session_workspace_shoot_idx').on(table.workspaceId, table.shootId),
    index('shoot_session_workspace_updated_idx').on(table.workspaceId, table.updatedAt),
    // Supports the calendar and agenda views, which scan a date window.
    index('shoot_session_workspace_starts_idx').on(table.workspaceId, table.startsAt),

    /**
     * A session that ends before it starts is always a bug — usually a form
     * that let the end time be edited without re-checking the start. Rejecting
     * it here means no query, chart or duration calculation downstream has to
     * defend against negative durations.
     */
    check('shoot_session_ends_after_starts', sql`${table.endsAt} > ${table.startsAt}`),
  ],
)

export type ShootSession = typeof shootSession.$inferSelect
export type NewShootSession = typeof shootSession.$inferInsert
