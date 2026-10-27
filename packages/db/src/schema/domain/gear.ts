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

export type GearItem = typeof gearItem.$inferSelect
export type NewGearItem = typeof gearItem.$inferInsert
export type ShootGear = typeof shootGear.$inferSelect
export type NewShootGear = typeof shootGear.$inferInsert
