import {
  boolean,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'

import { organization } from '../auth.ts'
import { primaryId, softDelete, timestamps, workspaceId } from '../columns.ts'
import { shoot } from './shoot.ts'
import { shot } from './shot.ts'

/**
 * Gear — the kit to prepare, so nothing is discovered missing on location.
 *
 * Two tables rather than one, deliberately.
 *
 * A free-text checklist per shoot would be simpler, and would mean retyping
 * "85mm f/1.4" for every shoot forever, with no way to ask what you own or
 * what is already committed elsewhere. A LIBRARY of owned kit makes "my 85mm"
 * one thing that can be selected into many shoots, counted, and later tracked
 * when it is out on a job or being repaired.
 *
 * The extra cost is one join. Retrofitting the library onto free-text rows
 * later would mean a migration plus deduplicating whatever people typed, so
 * it is worth paying now.
 */

/** The workspace's kit. Exists independently of any shoot. */
export const gearItem = pgTable(
  'gear_item',
  {
    id: primaryId(),
    workspaceId: workspaceId().references(() => organization.id, { onDelete: 'cascade' }),

    name: text('name').notNull(),
    /**
     * Free text, with suggestions offered in the UI. Photographers group kit
     * in ways no fixed list anticipates, and nothing branches on this value.
     */
    category: text('category'),
    notes: text('notes'),

    ...timestamps,
    ...softDelete,
  },
  (table) => [
    unique('gear_item_workspace_id_id_key').on(table.workspaceId, table.id),
    index('gear_item_workspace_updated_idx').on(table.workspaceId, table.updatedAt),
  ],
)

/** A piece of kit selected for a shoot. */
export const shootGear = pgTable(
  'shoot_gear',
  {
    id: primaryId(),
    workspaceId: workspaceId().references(() => organization.id, { onDelete: 'cascade' }),

    shootId: uuid('shoot_id').notNull(),
    gearItemId: uuid('gear_item_id').notNull(),

    quantity: integer('quantity').notNull().default(1),
    /** Ticked while packing. The point of the list on the day. */
    packed: boolean('packed').notNull().default(false),

    ...timestamps,
    ...softDelete,
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.shootId],
      foreignColumns: [shoot.workspaceId, shoot.id],
      name: 'shoot_gear_shoot_fk',
    }).onDelete('cascade'),

    /**
     * `restrict`, not `cascade`: deleting a library item must not silently
     * strip it from shoots that are already planned around it. The service
     * soft-deletes library items, so this is a backstop against a hard delete
     * quietly rewriting someone's packing list.
     */
    foreignKey({
      columns: [table.workspaceId, table.gearItemId],
      foreignColumns: [gearItem.workspaceId, gearItem.id],
      name: 'shoot_gear_item_fk',
    }).onDelete('restrict'),

    unique('shoot_gear_workspace_id_id_key').on(table.workspaceId, table.id),
    /** One row per item per shoot; quantity carries "two of them". */
    unique('shoot_gear_unique_item_per_shoot').on(
      table.workspaceId,
      table.shootId,
      table.gearItemId,
    ),
    index('shoot_gear_workspace_shoot_idx').on(table.workspaceId, table.shootId),
    index('shoot_gear_workspace_updated_idx').on(table.workspaceId, table.updatedAt),
  ],
)

/**
 * A piece of kit a specific SHOT calls for.
 *
 * ---------------------------------------------------------------------------
 * Why this is not called `shot_gear`
 * ---------------------------------------------------------------------------
 * `shoot_gear` already exists one line above. `shot_gear` differs from it by a
 * single letter, and both carry `workspace_id` and `gear_item_id` — so a typo
 * in a query would silently read or write the wrong table and still run. The
 * longer name makes that mistake impossible to spell by accident.
 *
 * The two are genuinely different things, which is what the name should say:
 *
 *   - `shoot_gear` is the PACKING LIST. It answers "what goes in the bag",
 *     which is why it has `packed` and is owned by the shoot.
 *   - `shot_gear_requirement` is a REQUIREMENT. It answers "this frame needs
 *     the 85mm and a reflector", and has no `packed` — you do not pack per
 *     shot, you pack once for the day.
 *
 * They coexist on purpose rather than one superseding the other.
 */
export const shotGearRequirement = pgTable(
  'shot_gear_requirement',
  {
    id: primaryId(),
    workspaceId: workspaceId().references(() => organization.id, { onDelete: 'cascade' }),

    shotId: uuid('shot_id').notNull(),
    gearItemId: uuid('gear_item_id').notNull(),

    quantity: integer('quantity').notNull().default(1),
    /** How the item is used for this frame — "gelled CTO", "on a boom". */
    notes: text('notes'),

    ...timestamps,
    ...softDelete,
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.shotId],
      foreignColumns: [shot.workspaceId, shot.id],
      name: 'shot_gear_requirement_shot_fk',
    }).onDelete('cascade'),

    /** `restrict` for the same reason as `shoot_gear` — see above. */
    foreignKey({
      columns: [table.workspaceId, table.gearItemId],
      foreignColumns: [gearItem.workspaceId, gearItem.id],
      name: 'shot_gear_requirement_item_fk',
    }).onDelete('restrict'),

    unique('shot_gear_requirement_workspace_id_id_key').on(table.workspaceId, table.id),
    /** One row per item per shot; quantity carries "two of them". */
    unique('shot_gear_requirement_unique_item_per_shot').on(
      table.workspaceId,
      table.shotId,
      table.gearItemId,
    ),
    index('shot_gear_requirement_workspace_shot_idx').on(table.workspaceId, table.shotId),
    index('shot_gear_requirement_workspace_updated_idx').on(table.workspaceId, table.updatedAt),
  ],
)

export type GearItem = typeof gearItem.$inferSelect
export type NewGearItem = typeof gearItem.$inferInsert
export type ShootGear = typeof shootGear.$inferSelect
export type NewShootGear = typeof shootGear.$inferInsert
export type ShotGearRequirement = typeof shotGearRequirement.$inferSelect
export type NewShotGearRequirement = typeof shotGearRequirement.$inferInsert
