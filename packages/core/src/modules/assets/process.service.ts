import { and, eq, isNull } from 'drizzle-orm'
import { schema, withTenant, type Database, type TenantContext } from '@pof/db'

import { NotFoundError } from '../../errors.ts'
import { applyUsageDelta, assetFootprint } from './usage.service.ts'
import type { ImagePort, VariantSpec } from '../../ports/image.ts'
import type { StoragePort } from '../../ports/storage.ts'

/**
 * Turn an uploaded original into something displayable.
 *
 * Runs in the worker, which has no request and therefore no session — so
 * every database touch goes through `withTenant` with a workspace carried on
 * the job payload. A handler that reached for a raw connection would not leak
 * data (row-level security fails closed), but it would silently do nothing,
 * which is its own kind of bug and a harder one to notice.
 */

const { asset } = schema

/**
 * Three sizes, two formats.
 *
 * The sizes map to how the images are actually used — a contact-sheet
 * thumbnail, a moodboard grid tile, and a lightbox view — rather than to
 * round numbers. `full` is capped at 2400 because beyond that a phone is
 * downloading megabytes it cannot display.
 *
 * AVIF and WebP, no JPEG fallback: both are supported by every browser this
 * app targets, and a third format would be a third render and a third
 * object for an audience that does not exist.
 */
export const VARIANT_SPECS: readonly VariantSpec[] = [
  { name: 'thumb', width: 400, format: 'avif' },
  { name: 'thumb', width: 400, format: 'webp' },
  { name: 'grid', width: 1200, format: 'avif' },
  { name: 'grid', width: 1200, format: 'webp' },
  { name: 'full', width: 2400, format: 'avif' },
  { name: 'full', width: 2400, format: 'webp' },
] as const

/** `w/{workspace}/a/{asset}/{name}.{format}`, beside the original. */
function variantKey(storageKey: string, name: string, format: string): string {
  const prefix = storageKey.slice(0, storageKey.lastIndexOf('/'))
  return `${prefix}/${name}.${format}`
}

export interface ProcessAssetResult {
  status: 'ready' | 'failed'
  failureReason?: string | undefined
}

/**
 * Process one asset. Idempotent: safe to run again after a crash or a retry.
 *
 * Failure is recorded on the row rather than only thrown. An asset whose
 * thumbnail never appears should be able to say why — "unsupported format",
 * "file is not an image" — instead of leaving someone staring at a blank
 * tile wondering whether to wait longer.
 */
export async function processAsset(
  db: Database,
  ctx: TenantContext,
  storage: StoragePort,
  image: ImagePort,
  assetId: string,
): Promise<ProcessAssetResult> {
  const row = await withTenant(db, ctx, async (tx) => {
    const [found] = await tx
      .select()
      .from(asset)
      .where(
        and(eq(asset.id, assetId), eq(asset.workspaceId, ctx.workspaceId), isNull(asset.deletedAt)),
      )
      .limit(1)

    if (!found) throw new NotFoundError('Asset', assetId)
    return found
  })

  /**
   * Already done. A retry after the status write but before the job was
   * acknowledged would otherwise re-render everything for nothing.
   */
  if (row.status === 'ready') return { status: 'ready' }

  /**
   * Fetching the original is NOT wrapped in the failure handler below.
   *
   * The distinction matters: a file that is not an image will fail the same
   * way every time, so recording it as `failed` is correct and retrying is
   * waste. Storage being unreachable is transient — marking those assets
   * permanently failed would mean one outage silently ruined every upload
   * in flight, with no path back. Those throw instead, and pg-boss retries.
   */
  const original = new Uint8Array(
    await new Response(await storage.get(row.storageKey)).arrayBuffer(),
  )

  /** Permanent, file-specific failures: recorded, not retried. */
  const markFailed = async (reason: string): Promise<ProcessAssetResult> => {
    const failureReason = reason.slice(0, 500)

    await withTenant(db, ctx, async (tx) => {
      await tx
        .update(asset)
        .set({ status: 'failed', failureReason })
        .where(and(eq(asset.id, assetId), eq(asset.workspaceId, ctx.workspaceId)))
    })

    return { status: 'failed', failureReason }
  }

  let metadata
  try {
    metadata = await image.inspect(original)
  } catch (error) {
    // The reason is shown to the user, so it has to read as a sentence.
    return markFailed(error instanceof Error ? error.message : 'Could not read this file')
  }

  /**
   * Rendered one at a time rather than in parallel. Six concurrent libvips
   * renders of a 50MB original is a memory spike the worker container has
   * no reason to take, and the queue already provides concurrency across
   * assets.
   */
  const variants: Record<string, Record<string, unknown>> = {}

  for (const spec of VARIANT_SPECS) {
    let rendered
    try {
      rendered = await image.render(original, spec)
    } catch (error) {
      return markFailed(
        error instanceof Error ? error.message : `Could not produce the ${spec.name} size`,
      )
    }

    const key = variantKey(row.storageKey, rendered.name, rendered.format)

    // Storage write: transient on failure, so it throws and is retried.
    await storage.put(key, rendered.bytes, { mime: `image/${rendered.format}` })

    variants[rendered.name] ??= {}
    variants[rendered.name]![rendered.format] = {
      key,
      width: rendered.width,
      height: rendered.height,
      bytes: rendered.bytes.byteLength,
    }
  }

  return withTenant(db, ctx, async (tx) => {
    await tx
      .update(asset)
      .set({
        status: 'ready',
        failureReason: null,
        width: metadata.width,
        height: metadata.height,
        capturedAt: metadata.capturedAt ?? null,
        latitude: metadata.latitude ?? null,
        longitude: metadata.longitude ?? null,
        variants,
      })
      .where(and(eq(asset.id, assetId), eq(asset.workspaceId, ctx.workspaceId)))

    /**
     * Only the derivatives: the original was counted at confirm.
     *
     * Expressed as new-minus-old rather than as a plain addition, which is
     * what makes it safe for the retries this pipeline takes for granted.
     * A job that failed after writing some variants and is retried
     * re-renders all of them, and this contributes only the difference —
     * zero when the set is unchanged. A bare `+= new` would inflate the
     * figure on every retry, and nothing would ever correct it.
     */
    const before = assetFootprint({ bytes: 0, variants: row.variants })
    const after = assetFootprint({ bytes: 0, variants })

    await applyUsageDelta(tx, ctx.workspaceId, { bytes: after - before, assets: 0 })

    return { status: 'ready' as const }
  })
}
