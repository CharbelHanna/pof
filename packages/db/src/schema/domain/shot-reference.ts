import { foreignKey, index, integer, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core'

import { organization } from '../auth.ts'
import { primaryId, softDelete, timestamps, workspaceId } from '../columns.ts'
import { asset } from './asset.ts'
import { shot } from './shot.ts'

/**
 * Reference images attached to one shot.
 *
 * The last relationship in the data model: `SHOT }o--o{ MEDIA`.
 *
 * Distinct from a moodboard item, and the distinction is the point. A
 * moodboard is a mood — the feel of the whole shoot, assembled before
 * anyone is on set. A shot reference is an instruction for one frame:
 * *this* crop, *this* pose, held up on the day while looking at the back of
 * a camera. The same uploaded file is often both, which is exactly why
 * neither owns it — `asset` does, and both point at it.
 *
 * Named `shot_reference` rather than `shot_media` or `shot_asset`. The
 * table says what the row means to a photographer, not which table it joins
 * — the same reasoning that made `shot_gear_requirement` a requirement
 * rather than a `shot_gear`.
 */
export const shotReference = pgTable(
  'shot_reference',
  {
    id: primaryId(),
    workspaceId: workspaceId().references(() => organization.id, { onDelete: 'cascade' }),

    shotId: uuid('shot_id').notNull(),
    assetId: uuid('asset_id').notNull(),

    /**
     * Ordering, because the first reference is the one someone glances at
     * between frames. Sparse (0, 10, 20) so one can be inserted between two
     * others without renumbering.
     */
    position: integer('position').notNull().default(0),

    /** What to take from it: "this crop", "hands like this", "not the colour". */
    note: text('note'),

    ...timestamps,
    ...softDelete,
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.shotId],
      foreignColumns: [shot.workspaceId, shot.id],
      name: 'shot_reference_shot_fk',
    }).onDelete('cascade'),

    /**
     * `restrict`, as everywhere an asset is pointed at: deleting a file must
     * not silently strip it from the frames planned around it. The service
     * soft-deletes assets, so this is a backstop against a hard delete
     * rewriting someone's shot list.
     */
    foreignKey({
      columns: [table.workspaceId, table.assetId],
      foreignColumns: [asset.workspaceId, asset.id],
      name: 'shot_reference_asset_fk',
    }).onDelete('restrict'),

    unique('shot_reference_workspace_id_id_key').on(table.workspaceId, table.id),
    /** One row per image per shot; wanting it twice on one frame is not a thing. */
    unique('shot_reference_unique_asset_per_shot').on(
      table.workspaceId,
      table.shotId,
      table.assetId,
    ),
    index('shot_reference_workspace_shot_idx').on(table.workspaceId, table.shotId, table.position),
    index('shot_reference_workspace_updated_idx').on(table.workspaceId, table.updatedAt),
  ],
)

export type ShotReference = typeof shotReference.$inferSelect
export type NewShotReference = typeof shotReference.$inferInsert
