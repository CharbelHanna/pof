import { boolean, doublePrecision, index, pgTable, text, unique } from 'drizzle-orm/pg-core'

import { organization } from '../auth.ts'
import { primaryId, softDelete, timestamps, workspaceId } from '../columns.ts'

/**
 * A place a shoot happens.
 *
 * A table rather than a text column on `shoot` because photographers return
 * to the same places, and because everything useful about a location —
 * access, permits, parking, and the light — is worth recording once rather
 * than retyping per shoot.
 *
 * Coordinates are stored on the row, not looked up on demand. Once a place is
 * resolved, sunrise, sunset and the golden and blue hours are computed
 * locally with no API at all, so the feature keeps working whether or not any
 * geocoding provider is reachable — which matters given none of the free ones
 * offer an availability guarantee.
 *
 * Deliberately NOT PostGIS: `double precision` plus Haversine in SQL covers
 * "locations near here" at this scale, and PostGIS is unavailable on several
 * managed Postgres hosts. See ARCHITECTURE.md on portability.
 */
export const location = pgTable(
  'location',
  {
    id: primaryId(),
    workspaceId: workspaceId().references(() => organization.id, { onDelete: 'cascade' }),

    name: text('name').notNull(),
    /** Full address as resolved, kept for display and disambiguation. */
    address: text('address'),

    latitude: doublePrecision('latitude').notNull(),
    longitude: doublePrecision('longitude').notNull(),

    /** Which provider resolved this, so a stale result can be traced. */
    provider: text('provider'),
    providerId: text('provider_id'),

    /** The things you wish you had written down last time. */
    accessNotes: text('access_notes'),
    parkingNotes: text('parking_notes'),
    permitRequired: boolean('permit_required').notNull().default(false),
    notes: text('notes'),

    ...timestamps,
    ...softDelete,
  },
  (table) => [
    unique('location_workspace_id_id_key').on(table.workspaceId, table.id),
    index('location_workspace_updated_idx').on(table.workspaceId, table.updatedAt),
  ],
)

export type Location = typeof location.$inferSelect
export type NewLocation = typeof location.$inferInsert
