import {
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'

import { organization } from '../auth.ts'
import { primaryId, softDelete, timestamps, workspaceId } from '../columns.ts'
import { shootSession } from './session.ts'
import { shoot } from './shoot.ts'

/**
 * Shots — the individual frames a photographer intends to come away with.
 *
 * This is the unit the work is actually measured in. A shoot is booked, a
 * session is scheduled, but a shot is the thing that either got captured or
 * did not, and it is what a client disputes after the fact.
 */

export const shotStatus = pgEnum('shot_status', [
  /** Intended, not yet attempted. */
  'planned',
  /** In the can. */
  'captured',
  /**
   * Deliberately abandoned — the light went, the location was closed, the
   * client changed their mind. Distinct from deletion: a skipped shot is a
   * fact about the shoot worth keeping, and quietly removing it would make
   * the plan look like it was always smaller than it was.
   */
  'skipped',
])

export const shot = pgTable(
  'shot',
  {
    id: primaryId(),
    workspaceId: workspaceId().references(() => organization.id, { onDelete: 'cascade' }),

    shootId: uuid('shoot_id').notNull(),
    /**
     * Null means the shot belongs to the shoot as a whole.
     *
     * The same "either level" shape crew and gear use. It matters more here:
     * shot ideas arrive long before anyone schedules the day they will be
     * taken, and forcing a session to exist first would push that thinking
     * into a notes field.
     */
    sessionId: uuid('session_id'),

    title: text('title').notNull(),
    description: text('description'),

    /**
     * Free text, like `crew_member.role` and for the same reason: nothing
     * branches on these, and photographers describe framing in whatever
     * vocabulary their genre uses. A reference table would mean a migration
     * to add "Dutch angle".
     */
    framing: text('framing'),
    subjects: text('subjects'),
    props: text('props'),

    status: shotStatus('status').notNull().default('planned'),

    /**
     * Manual ordering within a shoot. A shot list is a running order — the
     * sequence is the plan for the day, not an incidental detail — so it
     * cannot be derived from creation time or title.
     *
     * Sparse values (10, 20, 30) leave room to insert between two shots
     * without renumbering the rest.
     */
    position: integer('position').notNull().default(0),

    notes: text('notes'),

    ...timestamps,
    ...softDelete,
  },
  (table) => [
    // Composite FK: the database rejects a shot attached to another
    // workspace's shoot.
    foreignKey({
      columns: [table.workspaceId, table.shootId],
      foreignColumns: [shoot.workspaceId, shoot.id],
      name: 'shot_shoot_fk',
    }).onDelete('cascade'),

    /**
     * Includes `shoot_id` so the session must belong to THIS shoot, not
     * merely to the same workspace — otherwise a shot on shoot A could point
     * at a session of shoot B.
     *
     * Unenforced when `session_id` is null, which is the default FK behaviour
     * for a partially-null composite key and exactly what "the whole shoot"
     * needs.
     */
    foreignKey({
      columns: [table.workspaceId, table.shootId, table.sessionId],
      foreignColumns: [shootSession.workspaceId, shootSession.shootId, shootSession.id],
      name: 'shot_session_fk',
    }).onDelete('cascade'),

    // Lets other tables form composite FKs back to a shot without being able
    // to cross a workspace boundary.
    unique('shot_workspace_id_id_key').on(table.workspaceId, table.id),

    index('shot_workspace_shoot_idx').on(table.workspaceId, table.shootId),
    // The running order, which is how the list is almost always read.
    index('shot_workspace_shoot_position_idx').on(table.workspaceId, table.shootId, table.position),
    index('shot_workspace_updated_idx').on(table.workspaceId, table.updatedAt),
  ],
)

export type Shot = typeof shot.$inferSelect
export type NewShot = typeof shot.$inferInsert
