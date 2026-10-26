import { date, index, pgEnum, pgTable, text, unique } from 'drizzle-orm/pg-core'

import { organization } from '../auth.ts'
import { primaryId, softDelete, timestamps, workspaceId } from '../columns.ts'

/**
 * Campaign — an optional grouping of shoots.
 *
 * "Optional" is the important word. A landscape photographer planning one
 * sunrise shoot must never be forced to invent a campaign to contain it, so
 * `shoot.campaign_id` is nullable and **shoot remains the aggregate root**.
 * Sessions, shot lists and deliverables all hang off a shoot, never directly
 * off a campaign.
 *
 * Two fixed levels, not a self-referencing hierarchy: a `parent_id` tree would
 * make every listing query recursive and leave the UI permanently ambiguous
 * about which level the user is looking at.
 */

export const campaignStatus = pgEnum('campaign_status', [
  'draft',
  'active',
  'completed',
  'cancelled',
])

export const campaign = pgTable(
  'campaign',
  {
    id: primaryId(),
    workspaceId: workspaceId().references(() => organization.id, { onDelete: 'cascade' }),

    name: text('name').notNull(),
    /** What the client asked for, in their words. */
    brief: text('brief'),
    status: campaignStatus('status').notNull().default('draft'),

    /**
     * Plain dates, not timestamps: a campaign runs "through March", which has
     * no meaningful time of day and should not shift with a viewer's timezone.
     * Sessions are the thing that happens at an instant.
     */
    startsOn: date('starts_on'),
    endsOn: date('ends_on'),

    ...timestamps,
    ...softDelete,
  },
  (table) => [
    // Lets `shoot` reference (workspace_id, campaign_id) so the database
    // itself rejects a shoot pointing at another workspace's campaign.
    unique('campaign_workspace_id_id_key').on(table.workspaceId, table.id),
    index('campaign_workspace_updated_idx').on(table.workspaceId, table.updatedAt),
  ],
)

export type Campaign = typeof campaign.$inferSelect
export type NewCampaign = typeof campaign.$inferInsert
