import { foreignKey, index, integer, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core'

import { organization } from '../auth.ts'
import { primaryId, softDelete, timestamps, workspaceId } from '../columns.ts'
import { asset } from './asset.ts'
import { shoot } from './shoot.ts'

/**
 * Moodboards — curating references, as distinct from storing them.
 *
 * Two tables rather than one, and deliberately separate from `asset`.
 *
 * An asset is the storage and processing concern: bytes, derivatives, a
 * capture date. A moodboard item is a curation decision: this image, on this
 * board, in this position, with this caption. Keeping them apart is what
 * lets one uploaded reference sit on two boards AND be attached to a shot as
 * a framing reference, with no duplication — which is how photographers
 * actually use references. Folding the position and caption onto `asset`
 * would make the second board a copy of the file.
 *
 * Attached to the shoot, per the campaign-is-optional rule: `campaign_id` on
 * a shoot is nullable, so hanging boards off campaigns would leave a
 * standalone sunrise shoot unable to have one — and that is precisely the
 * photographer who wants a board.
 */

export const moodboard = pgTable(
  'moodboard',
  {
    id: primaryId(),
    workspaceId: workspaceId().references(() => organization.id, { onDelete: 'cascade' }),

    shootId: uuid('shoot_id').notNull(),

    name: text('name').notNull(),
    notes: text('notes'),

    ...timestamps,
    ...softDelete,
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.shootId],
      foreignColumns: [shoot.workspaceId, shoot.id],
      name: 'moodboard_shoot_fk',
    }).onDelete('cascade'),

    unique('moodboard_workspace_id_id_key').on(table.workspaceId, table.id),
    index('moodboard_workspace_shoot_idx').on(table.workspaceId, table.shootId),
    index('moodboard_workspace_updated_idx').on(table.workspaceId, table.updatedAt),
  ],
)

export const moodboardItem = pgTable(
  'moodboard_item',
  {
    id: primaryId(),
    workspaceId: workspaceId().references(() => organization.id, { onDelete: 'cascade' }),

    moodboardId: uuid('moodboard_id').notNull(),
    assetId: uuid('asset_id').notNull(),

    /**
     * Arrangement is the point of a moodboard — what sits next to what is
     * the idea being expressed — so order is data, not a display detail.
     * Sparse (0, 10, 20) so an image can be dropped between two others
     * without renumbering.
     */
    position: integer('position').notNull().default(0),

    /** Why this reference is here: "this light", "this crop", "not the pose". */
    caption: text('caption'),

    ...timestamps,
    ...softDelete,
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.moodboardId],
      foreignColumns: [moodboard.workspaceId, moodboard.id],
      name: 'moodboard_item_board_fk',
    }).onDelete('cascade'),

    /**
     * `restrict`, matching shoot_gear and session_location: deleting an
     * asset must not silently empty the boards built around it. Assets are
     * soft-deleted by the service, so this is a backstop against a hard
     * delete rewriting someone's curation.
     */
    foreignKey({
      columns: [table.workspaceId, table.assetId],
      foreignColumns: [asset.workspaceId, asset.id],
      name: 'moodboard_item_asset_fk',
    }).onDelete('restrict'),

    unique('moodboard_item_workspace_id_id_key').on(table.workspaceId, table.id),
    /**
     * One row per image per board. Wanting the same reference twice on one
     * board is not a thing; wanting it on two boards is, and that is a
     * different row.
     */
    unique('moodboard_item_unique_asset_per_board').on(
      table.workspaceId,
      table.moodboardId,
      table.assetId,
    ),
    index('moodboard_item_workspace_board_idx').on(
      table.workspaceId,
      table.moodboardId,
      table.position,
    ),
    index('moodboard_item_workspace_updated_idx').on(table.workspaceId, table.updatedAt),
  ],
)

export type Moodboard = typeof moodboard.$inferSelect
export type NewMoodboard = typeof moodboard.$inferInsert
export type MoodboardItem = typeof moodboardItem.$inferSelect
export type NewMoodboardItem = typeof moodboardItem.$inferInsert
