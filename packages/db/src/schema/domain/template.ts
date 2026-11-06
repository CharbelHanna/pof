import {
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'

import { organization } from '../auth.ts'
import { primaryId, softDelete, timestamps, workspaceId } from '../columns.ts'
import { shootType } from './shoot-type.ts'

/**
 * Session templates — the reusable prep blueprint that is the point of this
 * product.
 *
 * A photographer who shoots newborn sessions every week should not rebuild
 * the same shot list and the same kit list every time. A template holds that
 * structure once; applying it to a session copies the structure in.
 *
 * ---------------------------------------------------------------------------
 * THE TWO DECISIONS THIS SCHEMA EXISTS TO ENFORCE
 * ---------------------------------------------------------------------------
 *
 * 1. VERSIONS ARE IMMUTABLE. A published version is never edited. Changing a
 *    template publishes a new version beside the old one.
 *
 * 2. APPLYING COPIES, IT DOES NOT LINK. Applying writes real `shot` and
 *    `checklist_item` rows into the session.
 *
 * Together those mean a finished shoot is a historical artefact. If editing
 * the "Studio Portrait" template in March silently rewrote a January shoot's
 * shot list, the records would lie — and those records are exactly what gets
 * consulted in a client dispute or a reshoot.
 *
 * It does not feel worse than a live link, because provenance is kept and
 * versions are immutable: the two can be diffed. When a template is
 * republished, a future session can be offered "3 new items, 1 changed" with
 * a one-click merge, while past sessions are never touched. That is what
 * people actually want when they say "keep it in sync".
 *
 * ---------------------------------------------------------------------------
 * Workspace-owned only, for now.
 * ---------------------------------------------------------------------------
 * `workspace_id` is NOT NULL, like every other domain table. Seeded system
 * starter templates — shared, read-only, one copy for everybody — would need
 * a nullable `workspace_id` and a policy of the shape `workspace_id IS NULL
 * OR workspace_id = current_workspace`. That is the same trade `shoot_type`
 * documents, and the same conclusion applies: adding the column before
 * anything writes to it would mean a half-built feature and an isolation
 * suite carrying a special case for rows that cannot exist yet.
 */

export const templateItemKind = pgEnum('template_item_kind', [
  /** Becomes a `shot` row. */
  'shot',
  /**
   * Becomes a `checklist_item` row, inside a checklist named by the payload.
   *
   * Flat rather than nested — one template item per line, not one per list —
   * so every copied line carries its own provenance. A list-shaped item would
   * give a whole checklist one id, and the diff could then only say "this
   * list changed" rather than which line.
   */
  'checklist_item',
])

export const sessionTemplate = pgTable(
  'session_template',
  {
    id: primaryId(),
    workspaceId: workspaceId().references(() => organization.id, { onDelete: 'cascade' }),

    name: text('name').notNull(),

    /**
     * Optional genre. A template for newborn sessions is useless on a product
     * shoot, and this is what lets the interface offer the right ones first.
     * Null means it suits any genre.
     */
    shootTypeKey: text('shoot_type_key').references(() => shootType.key, {
      onDelete: 'set null',
    }),

    /**
     * The version applied when someone asks for "this template".
     *
     * Zero means nothing has been published yet: the template exists and has
     * been named, but has no content to apply. Kept as a plain integer rather
     * than a foreign key to the version row, so that reading the current
     * version number never needs a join.
     */
    currentVersion: integer('current_version').notNull().default(0),

    notes: text('notes'),

    ...timestamps,
    ...softDelete,
  },
  (table) => [
    unique('session_template_workspace_id_id_key').on(table.workspaceId, table.id),
    index('session_template_workspace_idx').on(table.workspaceId),
    index('session_template_workspace_updated_idx').on(table.workspaceId, table.updatedAt),
  ],
)

export const sessionTemplateVersion = pgTable(
  'session_template_version',
  {
    id: primaryId(),
    workspaceId: workspaceId().references(() => organization.id, { onDelete: 'cascade' }),

    templateId: uuid('template_id').notNull(),

    /** 1, 2, 3… unique per template. */
    version: integer('version').notNull(),

    publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),

    /** What changed, written by the author at publish time. */
    note: text('note'),

    /**
     * No `deleted_at`, deliberately.
     *
     * A version is a historical record that sessions point back at. Soft
     * deletion would create a state where an applied session references a
     * version the interface refuses to show, which is worse than either
     * keeping it or hard-deleting the template outright.
     */
    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.templateId],
      foreignColumns: [sessionTemplate.workspaceId, sessionTemplate.id],
      name: 'session_template_version_template_fk',
    }).onDelete('cascade'),

    // The immutability guarantee's other half: a version number is claimed
    // once and cannot be reused, so "version 2" means one thing forever.
    unique('session_template_version_number_key').on(
      table.workspaceId,
      table.templateId,
      table.version,
    ),

    unique('session_template_version_workspace_id_id_key').on(table.workspaceId, table.id),
    index('session_template_version_workspace_template_idx').on(
      table.workspaceId,
      table.templateId,
    ),
  ],
)

export const templateItem = pgTable(
  'template_item',
  {
    id: primaryId(),
    workspaceId: workspaceId().references(() => organization.id, { onDelete: 'cascade' }),

    versionId: uuid('version_id').notNull(),

    kind: templateItemKind('kind').notNull(),

    /**
     * The item's content, shaped by `kind`.
     *
     * `jsonb` rather than columns for every field of every kind, which would
     * be a table where most columns are null most of the time. Validated by a
     * Zod discriminated union in `@pof/schemas` before it is ever written, so
     * the looseness stops at the service boundary — the same arrangement as
     * `shoot.details`.
     */
    payload: jsonb('payload').notNull(),

    /** Order within the version. Sparse, like `shot.position`. */
    position: integer('position').notNull().default(0),

    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.versionId],
      foreignColumns: [sessionTemplateVersion.workspaceId, sessionTemplateVersion.id],
      name: 'template_item_version_fk',
    }).onDelete('cascade'),

    unique('template_item_workspace_id_id_key').on(table.workspaceId, table.id),
    index('template_item_workspace_version_idx').on(table.workspaceId, table.versionId),
    index('template_item_workspace_version_position_idx').on(
      table.workspaceId,
      table.versionId,
      table.position,
    ),
  ],
)

export type SessionTemplate = typeof sessionTemplate.$inferSelect
export type NewSessionTemplate = typeof sessionTemplate.$inferInsert
export type SessionTemplateVersion = typeof sessionTemplateVersion.$inferSelect
export type NewSessionTemplateVersion = typeof sessionTemplateVersion.$inferInsert
export type TemplateItem = typeof templateItem.$inferSelect
export type NewTemplateItem = typeof templateItem.$inferInsert
