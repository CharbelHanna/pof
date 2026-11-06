import {
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'

import { organization } from '../auth.ts'
import { primaryId, softDelete, timestamps, workspaceId } from '../columns.ts'
import { shootSession } from './session.ts'
import { shoot } from './shoot.ts'

/**
 * Checklists — the things that must be done or brought, as opposed to the
 * frames that must be taken.
 *
 * Deliberately separate from `shot`. A shot is an intention about an image and
 * has a creative life: it is described, framed, referenced, and either captured
 * or abandoned. A checklist item is a fact about readiness — the battery is
 * charged or it is not. Collapsing the two would mean one table where half the
 * columns are always null, and a UI that cannot decide what it is showing.
 */

export const checklistKind = pgEnum('checklist_kind', [
  /** What to bring. The one that gets checked in a car park at 05:00. */
  'gear',
  /** What to do beforehand — charge, format, confirm, book, scout. */
  'prep',
  /** What happens after the shutter stops: backup, cull, deliver. */
  'post',
  /** Getting there and back: permits, parking, tickets, access codes. */
  'travel',
])

export const checklist = pgTable(
  'checklist',
  {
    id: primaryId(),
    workspaceId: workspaceId().references(() => organization.id, { onDelete: 'cascade' }),

    shootId: uuid('shoot_id').notNull(),
    /**
     * Null means the checklist belongs to the shoot as a whole.
     *
     * The same "either level" shape as `shot`, crew and gear, and the split
     * falls naturally along `kind`: a gear list is usually per-shoot, because
     * the bag is packed once for the trip. A prep list is often per-session,
     * because each day has its own call time and its own things to confirm.
     * Neither is a rule worth enforcing, so the column is simply nullable and
     * the user decides.
     */
    sessionId: uuid('session_id'),

    kind: checklistKind('kind').notNull().default('prep'),

    /**
     * A shoot can hold several lists of the same kind — "Camera bag" and
     * "Lighting case" are both gear, and packing them as one list is how
     * things get left behind.
     */
    name: text('name').notNull(),

    /** Manual ordering among the lists on a shoot. Sparse, like `shot`. */
    position: integer('position').notNull().default(0),

    notes: text('notes'),

    ...timestamps,
    ...softDelete,
  },
  (table) => [
    // Composite FK: the database rejects a checklist attached to another
    // workspace's shoot.
    foreignKey({
      columns: [table.workspaceId, table.shootId],
      foreignColumns: [shoot.workspaceId, shoot.id],
      name: 'checklist_shoot_fk',
    }).onDelete('cascade'),

    /**
     * Includes `shoot_id` so the session must belong to THIS shoot, not merely
     * to the same workspace. Unenforced when `session_id` is null, which is the
     * default behaviour for a partially-null composite key and exactly what
     * "the whole shoot" needs.
     */
    foreignKey({
      columns: [table.workspaceId, table.shootId, table.sessionId],
      foreignColumns: [shootSession.workspaceId, shootSession.shootId, shootSession.id],
      name: 'checklist_session_fk',
    }).onDelete('cascade'),

    // Lets `checklist_item` form a composite FK back without being able to
    // cross a workspace boundary.
    unique('checklist_workspace_id_id_key').on(table.workspaceId, table.id),

    index('checklist_workspace_shoot_idx').on(table.workspaceId, table.shootId),
    index('checklist_workspace_shoot_position_idx').on(
      table.workspaceId,
      table.shootId,
      table.position,
    ),
    index('checklist_workspace_updated_idx').on(table.workspaceId, table.updatedAt),
  ],
)

export const checklistItem = pgTable(
  'checklist_item',
  {
    id: primaryId(),
    workspaceId: workspaceId().references(() => organization.id, { onDelete: 'cascade' }),

    checklistId: uuid('checklist_id').notNull(),

    label: text('label').notNull(),

    /**
     * "Two of them" — spare batteries, memory cards, sandbags. Not a reference
     * to `gear_item`: a checklist is written in whatever words come to hand
     * while packing, and requiring every line to resolve to an inventory row
     * would make the list slower to write than a note on a phone.
     *
     * Linking a line to owned gear is worth doing later, as an enrichment
     * rather than a precondition.
     */
    quantity: integer('quantity').notNull().default(1),

    /**
     * When it was ticked, not whether.
     *
     * A boolean would answer the wrong question. "Packed at 04:52" tells you
     * the list was worked through on the morning rather than two weeks ago from
     * memory, and it is what makes a half-finished list legible when you pick
     * it up again at the car.
     */
    doneAt: timestamp('done_at', { withTimezone: true, mode: 'date' }),

    /** Running order within the list. Sparse, like `shot.position`. */
    position: integer('position').notNull().default(0),

    notes: text('notes'),

    /**
     * Where this row came from, when it was copied from a template.
     *
     * Deliberately NOT a foreign key. Provenance is a historical record and
     * has to outlive the template it names — deleting a template must not
     * cascade into the shoots that were run from it, and must not be blocked
     * by them either. A dangling id here means "copied from something since
     * removed", which is the truth and is still more useful than null.
     */
    sourceTemplateItemId: uuid('source_template_item_id'),

    ...timestamps,
    ...softDelete,
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.checklistId],
      foreignColumns: [checklist.workspaceId, checklist.id],
      name: 'checklist_item_checklist_fk',
    }).onDelete('cascade'),

    unique('checklist_item_workspace_id_id_key').on(table.workspaceId, table.id),

    index('checklist_item_workspace_checklist_idx').on(table.workspaceId, table.checklistId),
    index('checklist_item_workspace_checklist_position_idx').on(
      table.workspaceId,
      table.checklistId,
      table.position,
    ),
    index('checklist_item_workspace_updated_idx').on(table.workspaceId, table.updatedAt),
  ],
)

export type Checklist = typeof checklist.$inferSelect
export type NewChecklist = typeof checklist.$inferInsert
export type ChecklistItem = typeof checklistItem.$inferSelect
export type NewChecklistItem = typeof checklistItem.$inferInsert
