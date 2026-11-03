import { and, asc, eq, gt, gte, isNull, sql, type SQL } from 'drizzle-orm'
import { schema, withTenant, type Database, type TenantContext } from '@pof/db'
import {
  MAX_ASSET_BYTES,
  type ConfirmUploadInput,
  type CreateUploadInput,
  type ListAssetsInput,
} from '@pof/schemas'

import { NotFoundError, ValidationError } from '../../errors.ts'
import { JOB_NAMES, type JobQueuePort } from '../../ports/jobs.ts'
import type { StoragePort, UploadTarget } from '../../ports/storage.ts'

/**
 * Assets — the upload lifecycle.
 *
 * Three steps, because the bytes go straight to the bucket:
 *
 *   1. createUpload  — row written as `pending`, target issued
 *   2. (the browser PUTs to storage; this server sees none of it)
 *   3. confirmUpload — verify the object is really there, record its true
 *                      size, flip to `uploaded`
 *
 * The security decision lives here rather than in the adapter. Row-level
 * security governs the table; it has no reach into object storage. So a
 * target is only ever issued after the asset row has been read back through
 * `withTenant`, and the key embeds the workspace id so it cannot be guessed
 * across tenants.
 */

const { asset } = schema

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/tiff': 'tif',
}

function visibility(workspaceId: string, includeDeleted: boolean): SQL | undefined {
  const scope = eq(asset.workspaceId, workspaceId)
  return includeDeleted ? scope : and(scope, isNull(asset.deletedAt))
}

/**
 * `w/{workspaceId}/a/{assetId}/original.{ext}`.
 *
 * The workspace prefix does real work: it makes a whole-workspace delete a
 * prefix operation for the GDPR erase job, and it means a key leaked from
 * one tenant tells an attacker nothing about another's.
 */
function originalKey(workspaceId: string, assetId: string, mime: string): string {
  return `w/${workspaceId}/a/${assetId}/original.${EXTENSIONS[mime] ?? 'bin'}`
}

export async function createUpload(
  db: Database,
  ctx: TenantContext,
  storage: StoragePort,
  input: CreateUploadInput,
): Promise<{ asset: typeof asset.$inferSelect; target: UploadTarget }> {
  const row = await withTenant(db, ctx, async (tx) => {
    const assetId = input.id ?? crypto.randomUUID()
    const key = originalKey(ctx.workspaceId, assetId, input.mime)

    const [created] = await tx
      .insert(asset)
      .values({
        id: assetId,
        workspaceId: ctx.workspaceId,
        storageKey: key,
        mime: input.mime,
        filename: input.filename ?? null,
        bytes: input.bytes ?? null,
        status: 'pending',
      })
      .onConflictDoNothing({ target: asset.id })
      .returning()

    if (created) return created

    /**
     * Replayed create — a retried request or a resumed upload. Returning the
     * existing row lets the client ask for a fresh target against the same
     * asset instead of orphaning the first one.
     */
    const [existing] = await tx
      .select()
      .from(asset)
      .where(and(eq(asset.id, assetId), visibility(ctx.workspaceId, true)))
      .limit(1)

    if (!existing) throw new NotFoundError('Asset', assetId)
    if (existing.status === 'ready') {
      throw new ValidationError('That asset has already been uploaded', 'id')
    }
    return existing
  })

  // Issued only after the row was written and read under withTenant, so the
  // caller is provably entitled to this key.
  const target = await storage.createUploadTarget(row.storageKey, {
    mime: row.mime,
    maxBytes: MAX_ASSET_BYTES,
  })

  return { asset: row, target }
}

export async function confirmUpload(
  db: Database,
  ctx: TenantContext,
  storage: StoragePort,
  input: ConfirmUploadInput,
  /**
   * Optional so the upload path still works with no worker running — the
   * asset simply stays `uploaded` and can be processed later. Making it
   * required would mean a queue outage blocked uploads entirely, which is a
   * worse failure than a late thumbnail.
   */
  jobs?: JobQueuePort,
) {
  const row = await withTenant(db, ctx, async (tx) => {
    const [found] = await tx
      .select()
      .from(asset)
      .where(and(eq(asset.id, input.id), visibility(ctx.workspaceId, false)))
      .limit(1)

    if (!found) throw new NotFoundError('Asset', input.id)
    return found
  })

  if (row.status === 'ready' || row.status === 'uploaded') return row

  /**
   * Ask storage, do not believe the client.
   *
   * This is the only point at which "the upload happened" becomes true, and
   * a client claiming success for bytes it never sent would otherwise queue
   * a processing job against an object that does not exist.
   */
  const head = await storage.head(row.storageKey)
  if (!head) {
    throw new ValidationError('No file was uploaded for that asset', 'id')
  }

  /**
   * The real size, checked after the fact. The upload target deliberately
   * does not sign a content length — doing so would make the client declare
   * an exact byte count up front and fail the whole upload on a mismatch of
   * one — so this is where the limit is actually enforced.
   */
  if (head.size > MAX_ASSET_BYTES) {
    await storage.delete([row.storageKey])
    await withTenant(db, ctx, async (tx) => {
      await tx
        .update(asset)
        .set({ status: 'failed', failureReason: 'File exceeds the maximum size' })
        .where(and(eq(asset.id, row.id), visibility(ctx.workspaceId, false)))
    })
    throw new ValidationError('That file is larger than the 50MB limit', 'id')
  }

  const updated = await withTenant(db, ctx, async (tx) => {
    const [confirmed] = await tx
      .update(asset)
      .set({ status: 'uploaded', bytes: head.size, uploadedAt: new Date() })
      .where(and(eq(asset.id, row.id), visibility(ctx.workspaceId, false)))
      .returning()

    if (!confirmed) throw new NotFoundError('Asset', row.id)
    return confirmed
  })

  /**
   * Queued after the status is committed, so a worker cannot pick the job up
   * and find the row still `pending`.
   *
   * A failure to enqueue is logged, not thrown: the bytes are safely stored
   * and the row is correct, so failing the request here would tell the user
   * their upload did not work when it did. The asset stays `uploaded` and
   * can be swept.
   */
  if (jobs) {
    try {
      await jobs.enqueue(
        JOB_NAMES.assetProcess,
        { workspaceId: ctx.workspaceId, assetId: updated.id },
        // Confirming twice must not render six derivatives twice.
        { singletonKey: `asset.process:${updated.id}` },
      )
    } catch (error) {
      console.error('[assets] could not queue processing for', updated.id, error)
    }
  }

  return updated
}

export async function listAssets(db: Database, ctx: TenantContext, input: ListAssetsInput) {
  return withTenant(db, ctx, async (tx) => {
    const predicates: (SQL | undefined)[] = [visibility(ctx.workspaceId, input.includeDeleted)]

    if (input.status) predicates.push(eq(asset.status, input.status))
    if (input.updatedSince) predicates.push(gte(asset.updatedAt, input.updatedSince))
    if (input.cursor) predicates.push(gt(asset.id, input.cursor))

    const rows = await tx
      .select()
      .from(asset)
      .where(and(...predicates))
      .orderBy(asc(asset.id))
      .limit(input.limit + 1)

    const [clock] = await tx.execute<{ now: string }>(sql`select transaction_timestamp() as now`)

    const hasMore = rows.length > input.limit
    const page = hasMore ? rows.slice(0, input.limit) : rows

    return {
      items: page,
      nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
      syncedAt: new Date(clock!.now),
    }
  })
}

/** A time-limited URL for one asset's original. */
export async function createReadUrl(
  db: Database,
  ctx: TenantContext,
  storage: StoragePort,
  id: string,
  ttlSeconds = 300,
): Promise<string> {
  const row = await withTenant(db, ctx, async (tx) => {
    const [found] = await tx
      .select({ storageKey: asset.storageKey })
      .from(asset)
      .where(and(eq(asset.id, id), visibility(ctx.workspaceId, false)))
      .limit(1)

    if (!found) throw new NotFoundError('Asset', id)
    return found
  })

  // Re-read under withTenant before signing: a signed URL outlives the
  // request, so the entitlement check cannot be skipped on the grounds that
  // the caller "already" had the id.
  return storage.createReadUrl(row.storageKey, ttlSeconds)
}

/**
 * Soft-delete the row; the bytes are swept separately.
 *
 * Deleting the object here would make the operation unrecoverable and would
 * break sync clients, which need the tombstone to learn the asset went away.
 * The GDPR erase job (Phase 7) removes bytes by workspace prefix.
 */
export async function deleteAsset(db: Database, ctx: TenantContext, id: string) {
  return withTenant(db, ctx, async (tx) => {
    const [row] = await tx
      .update(asset)
      .set({ deletedAt: new Date() })
      .where(and(eq(asset.id, id), visibility(ctx.workspaceId, false)))
      .returning()

    if (!row) throw new NotFoundError('Asset', id)
    return row
  })
}
