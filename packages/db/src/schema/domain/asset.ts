import {
  bigint,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core'

import { organization } from '../auth.ts'
import { primaryId, softDelete, timestamps, workspaceId } from '../columns.ts'

/**
 * Assets — uploaded files, and everything known about them.
 *
 * The row exists BEFORE the bytes do. An upload is three steps: create the
 * row and hand back a target, the browser PUTs directly to storage, then the
 * client confirms. That ordering is what lets the file go straight to the
 * bucket without transiting this server, and it is why `status` is not
 * decoration — a `pending` row with no object behind it is a normal,
 * expected state, not corruption.
 *
 * Deliberately decoupled from moodboards and shots. One uploaded reference
 * can sit on two moodboards and be attached to a shot as a framing
 * reference, with no duplication — which is how photographers actually use
 * references. Curation is a separate concern from storage.
 */

export const assetStatus = pgEnum('asset_status', [
  /** The row exists and an upload target was issued; no bytes confirmed. */
  'pending',
  /** Bytes are in the bucket; the worker has not finished with them. */
  'uploaded',
  /** Derivatives exist and metadata is extracted. Safe to display. */
  'ready',
  /**
   * Processing failed — an unreadable file, an unsupported codec, a worker
   * crash. Kept rather than deleted so the user sees *why* a thumbnail
   * never appeared, and so a retry has something to retry.
   */
  'failed',
])

export const asset = pgTable(
  'asset',
  {
    id: primaryId(),
    workspaceId: workspaceId().references(() => organization.id, { onDelete: 'cascade' }),

    /**
     * Where the original lives, relative to the bucket. Always
     * `w/{workspaceId}/a/{assetId}/original.{ext}`.
     *
     * The workspace id is in the key on purpose. Row-level security does not
     * reach into object storage, so a leaked or guessed key is an unscoped
     * read — embedding the tenant makes keys unguessable across workspaces
     * and makes a whole-workspace delete a prefix operation.
     */
    storageKey: text('storage_key').notNull(),

    /** What the client claimed, validated against an allow-list on create. */
    mime: text('mime').notNull(),
    /** As reported by the storage provider on confirm, never by the client. */
    bytes: bigint('bytes', { mode: 'number' }),

    /** Original filename, for download and for the user to recognise it. */
    filename: text('filename'),

    width: integer('width'),
    height: integer('height'),

    status: assetStatus('status').notNull().default('pending'),
    /** Why processing failed, shown to the user rather than only logged. */
    failureReason: text('failure_reason'),

    /**
     * Derivative descriptors, keyed by name — `thumb`, `grid`, `full` — each
     * carrying its own key, format, width and height.
     *
     * jsonb rather than a table: these are written once by the worker, read
     * as a whole, and never queried across assets. A `derivative` table
     * would be a join on every image render for no gain.
     */
    variants: jsonb('variants').notNull().default({}),

    /**
     * Capture metadata, lifted out of EXIF into columns because these are
     * the parts photographers query: when it was taken, and where.
     *
     * The rest of the EXIF block is deliberately NOT retained — it carries
     * serial numbers, owner names and software fingerprints, and stripping
     * it from derivatives is the privacy-preserving default. A boudoir
     * client's file should not ship its GPS coordinates to anyone given a
     * link.
     */
    capturedAt: timestamp('captured_at', { withTimezone: true, mode: 'date' }),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),

    /** Set once the bytes are confirmed present, for diagnosing stuck rows. */
    uploadedAt: timestamp('uploaded_at', { withTimezone: true, mode: 'date' }),

    ...timestamps,
    ...softDelete,
  },
  (table) => [
    unique('asset_workspace_id_id_key').on(table.workspaceId, table.id),
    /** A key identifies exactly one asset; a collision would overwrite bytes. */
    unique('asset_storage_key_key').on(table.storageKey),

    index('asset_workspace_updated_idx').on(table.workspaceId, table.updatedAt),
    /**
     * Supports the sweep for abandoned uploads: rows left `pending` because
     * the browser closed mid-upload, which would otherwise accumulate
     * forever.
     */
    index('asset_workspace_status_idx').on(table.workspaceId, table.status),
  ],
)

export type Asset = typeof asset.$inferSelect
export type NewAsset = typeof asset.$inferInsert
