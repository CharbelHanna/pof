import {
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'

import { primaryId, softDelete, timestamps, workspaceId } from '../columns.ts'
import { organization } from '../auth.ts'
import { campaign } from './campaign.ts'
import { location } from './location.ts'
import { shootType } from './shoot-type.ts'

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
     * Optional parent. A single sunrise shoot needs no campaign, so this
     * stays nullable and `shoot` remains the aggregate root.
     */
    campaignId: uuid('campaign_id'),

    /**
     * References `shoot_type.key`. A text key into a reference TABLE rather
     * than an enum, so adding a genre is an INSERT rather than a migration.
     */
    shootTypeKey: text('shoot_type_key')
      .notNull()
      .default('portrait')
      .references(() => shootType.key, { onUpdate: 'cascade' }),

    status: shootStatus('status').notNull().default('draft'),

    /**
     * The shoot's main place. Sessions may override it — a landscape trip
     * visits several locations, and the light differs at each.
     */
    primaryLocationId: uuid('primary_location_id'),

    /** When the edit is due with the client. A plain date — no time of day. */
    deliveryDate: date('delivery_date'),

    /**
     * Genre-specific fields, validated in the application by the shoot-type
     * registry in `@pof/schemas`.
     *
     * Only trivia nothing queries lives here — `{publication, issueDate}` for
     * editorial, `{skuCount, surfaceFinish}` for product. Anything
     * cross-genre or filterable is a real column above. When a field in here
     * proves cross-genre, promote it to a column; that path is what keeps
     * jsonb from becoming a dumping ground.
     */
    details: jsonb('details').notNull().default({}),

    /**
     * The registry version `details` was written under, so a payload can be
     * migrated lazily on read instead of in one large backfill.
     */
    detailsSchemaVersion: integer('details_schema_version').notNull().default(1),

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
     * Composite FK to campaign: the database rejects a shoot pointing at
     * another workspace's campaign, rather than relying on the application to
     * remember.
     *
     * `set null` rather than `cascade` — deleting a campaign must not silently
     * take its shoots with it. Losing a shoot is losing real planning work;
     * losing its grouping is an inconvenience.
     */
    foreignKey({
      columns: [table.workspaceId, table.campaignId],
      foreignColumns: [campaign.workspaceId, campaign.id],
      name: 'shoot_campaign_fk',
    }).onDelete('set null'),

    /**
     * Supports the default list view (a workspace's shoots, newest first) and
     * the `updatedSince` incremental-sync query the mobile app will use.
     */
    index('shoot_workspace_updated_idx').on(table.workspaceId, table.updatedAt),
    foreignKey({
      columns: [table.workspaceId, table.primaryLocationId],
      foreignColumns: [location.workspaceId, location.id],
      name: 'shoot_primary_location_fk',
    }).onDelete('set null'),

    index('shoot_workspace_campaign_idx').on(table.workspaceId, table.campaignId),
  ],
)

export type Shoot = typeof shoot.$inferSelect
export type NewShoot = typeof shoot.$inferInsert
