import { foreignKey, index, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core'

import { organization } from '../auth.ts'
import { primaryId, softDelete, timestamps, workspaceId } from '../columns.ts'
import { shootSession } from './session.ts'
import { shoot } from './shoot.ts'

/**
 * Crew — who is working a shoot.
 *
 * Crew size drives call times, how many hands are free for lighting, and what
 * a client is billed for, so it belongs in the plan rather than in someone's
 * head.
 *
 * `session_id` is nullable: most crew are booked for the whole shoot, but an
 * assistant might come to the studio day and not the rooftop golden hour.
 * Same "either level" shape the checklists use.
 */
export const crewMember = pgTable(
  'crew_member',
  {
    id: primaryId(),
    workspaceId: workspaceId().references(() => organization.id, { onDelete: 'cascade' }),

    shootId: uuid('shoot_id').notNull(),
    /** Null means the whole shoot. */
    sessionId: uuid('session_id'),

    /**
     * Free text rather than a reference table, unlike `shoot_type`.
     *
     * The two are not the same kind of thing. A shoot type is referenced by a
     * foreign key and selects a validation schema, so it has to be a known
     * value. A crew role is a label nothing branches on, and real crews
     * invent them — "digitech", "second shooter", "dog handler". A reference
     * table would mean a migration every time someone hires a role we did not
     * think of. Common values are offered as suggestions in the UI instead.
     */
    role: text('role').notNull(),
    /** Optional: a role is enough to plan with before anyone is booked. */
    name: text('name'),
    notes: text('notes'),

    ...timestamps,
    ...softDelete,
  },
  (table) => [
    // Composite FK: the database rejects crew attached to another
    // workspace's shoot.
    foreignKey({
      columns: [table.workspaceId, table.shootId],
      foreignColumns: [shoot.workspaceId, shoot.id],
      name: 'crew_member_shoot_fk',
    }).onDelete('cascade'),

    /**
     * Includes `shoot_id` so the session must belong to THIS shoot — not
     * merely to the same workspace. A plain reference to the session would
     * allow crew on shoot A pointing at a session of shoot B.
     *
     * Unenforced when `session_id` is null, which is the default FK
     * behaviour for a partially-null composite key and exactly what "the
     * whole shoot" needs.
     */
    foreignKey({
      columns: [table.workspaceId, table.shootId, table.sessionId],
      foreignColumns: [shootSession.workspaceId, shootSession.shootId, shootSession.id],
      name: 'crew_member_session_fk',
    }).onDelete('cascade'),

    unique('crew_member_workspace_id_id_key').on(table.workspaceId, table.id),
    index('crew_member_workspace_shoot_idx').on(table.workspaceId, table.shootId),
    index('crew_member_workspace_updated_idx').on(table.workspaceId, table.updatedAt),
  ],
)

export type CrewMember = typeof crewMember.$inferSelect
export type NewCrewMember = typeof crewMember.$inferInsert
