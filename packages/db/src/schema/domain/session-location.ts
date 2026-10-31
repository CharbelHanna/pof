import { foreignKey, index, integer, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core'

import { organization } from '../auth.ts'
import { primaryId, softDelete, timestamps, workspaceId } from '../columns.ts'
import { location } from './location.ts'
import { shootSession } from './session.ts'

/**
 * Where a session happens — many locations, in a planned order.
 *
 * This replaces `shoot_session.location_id`, which allowed exactly one. A
 * location was always reusable across sessions; what was missing was the
 * other direction, and that direction is the normal case for the genre this
 * app was built around. A landscape session is a route: park at the layby,
 * walk to the lochside for blue hour, climb to the ridge for sunrise. Those
 * are three locations in one session, and squeezing them into one row meant
 * the other two lived in a notes field where nothing could compute sun times
 * for them or put them on a map.
 *
 * `position` is what makes this a route rather than a set. The order is the
 * plan — it decides what is reachable before the light goes — so it cannot be
 * derived from creation time or name.
 */
export const sessionLocation = pgTable(
  'session_location',
  {
    id: primaryId(),
    workspaceId: workspaceId().references(() => organization.id, { onDelete: 'cascade' }),

    sessionId: uuid('session_id').notNull(),
    locationId: uuid('location_id').notNull(),

    /**
     * Visit order. Sparse (0, 10, 20) so a stop can be inserted between two
     * others without renumbering, and bounded well below int4 so repeated
     * midpoint insertion cannot overflow.
     *
     * The lowest position is the session's primary location: it is what sun
     * times and the map centre on when a single answer is needed.
     */
    position: integer('position').notNull().default(0),

    /** Why this stop — "park here", "permit needed", "20 min walk in". */
    notes: text('notes'),

    ...timestamps,
    ...softDelete,
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.sessionId],
      foreignColumns: [shootSession.workspaceId, shootSession.id],
      name: 'session_location_session_fk',
    }).onDelete('cascade'),

    /**
     * `restrict`, not `cascade`: deleting a saved location must not silently
     * remove it from sessions planned around it. The service soft-deletes
     * locations, so this is a backstop against a hard delete rewriting
     * someone's route.
     */
    foreignKey({
      columns: [table.workspaceId, table.locationId],
      foreignColumns: [location.workspaceId, location.id],
      name: 'session_location_location_fk',
    }).onDelete('restrict'),

    unique('session_location_workspace_id_id_key').on(table.workspaceId, table.id),
    /** One row per location per session; revisiting is ordering, not duplication. */
    unique('session_location_unique_per_session').on(
      table.workspaceId,
      table.sessionId,
      table.locationId,
    ),
    index('session_location_workspace_session_idx').on(
      table.workspaceId,
      table.sessionId,
      table.position,
    ),
    index('session_location_workspace_updated_idx').on(table.workspaceId, table.updatedAt),
  ],
)

export type SessionLocation = typeof sessionLocation.$inferSelect
export type NewSessionLocation = typeof sessionLocation.$inferInsert
