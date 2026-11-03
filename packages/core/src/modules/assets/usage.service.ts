import { eq, sql } from 'drizzle-orm'
import { schema, withTenant, type Database, type TenantContext, type TenantDb } from '@pof/db'
import { parseVariants } from '@pof/schemas'

/**
 * What a workspace is consuming, maintained as it changes.
 *
 * Every write here is a DELTA applied inside the transaction that changed an
 * asset, never an absolute figure computed elsewhere. That is the whole
 * design, and it is what makes the counter safe under the retries this
 * pipeline takes for granted: a reprocessed asset contributes
 * `new - old`, which is zero when nothing actually changed.
 *
 * Writing an absolute would need a read-modify-write across two statements,
 * and two uploads finishing together would lose one of them.
 */

const { asset, workspaceUsage } = schema

/**
 * Everything an asset occupies: the original plus every derivative.
 *
 * Derivatives are counted because they are real objects in the bucket — six
 * of them per image, and for a small original they can exceed it. A figure
 * that ignored them would understate a workspace by more than half and make
 * any future limit meaningless.
 */
export function assetFootprint(row: { bytes: number | null; variants: unknown }): number {
  const variants = parseVariants(row.variants)

  let total = row.bytes ?? 0
  for (const formats of Object.values(variants)) {
    for (const variant of Object.values(formats ?? {})) {
      total += variant?.bytes ?? 0
    }
  }
  return total
}

export interface UsageDelta {
  bytes: number
  assets: number
}

/**
 * Apply a delta, creating the row on first use.
 *
 * Takes a transaction rather than a database handle: it is only ever correct
 * to call this in the same transaction as the change it accounts for.
 * Calling it separately would mean a crash between the two leaves the
 * counter permanently wrong.
 *
 * `GREATEST(..., 0)` clamps the result. Not to paper over a bug — any
 * negative would be one — but because a counter that has drifted below zero
 * is harder to reason about than one that is merely wrong, and a limit
 * check reading a negative would let a workspace upload forever.
 */
export async function applyUsageDelta(
  tx: TenantDb,
  workspaceId: string,
  delta: UsageDelta,
): Promise<void> {
  if (delta.bytes === 0 && delta.assets === 0) return

  await tx
    .insert(workspaceUsage)
    .values({
      workspaceId,
      storageBytes: Math.max(delta.bytes, 0),
      assetCount: Math.max(delta.assets, 0),
    })
    .onConflictDoUpdate({
      target: workspaceUsage.workspaceId,
      set: {
        storageBytes: sql`greatest(${workspaceUsage.storageBytes} + ${delta.bytes}, 0)`,
        assetCount: sql`greatest(${workspaceUsage.assetCount} + ${delta.assets}, 0)`,
      },
    })
}

/** Current usage, zeroed if nothing has been uploaded yet. */
export async function getUsage(
  db: Database,
  ctx: TenantContext,
): Promise<{ storageBytes: number; assetCount: number }> {
  return withTenant(db, ctx, async (tx) => {
    const [row] = await tx
      .select({
        storageBytes: workspaceUsage.storageBytes,
        assetCount: workspaceUsage.assetCount,
      })
      .from(workspaceUsage)
      .where(eq(workspaceUsage.workspaceId, ctx.workspaceId))
      .limit(1)

    // Absence means nothing has been uploaded, not an error. The row is
    // created on first use rather than with the workspace.
    return row ?? { storageBytes: 0, assetCount: 0 }
  })
}

/**
 * Recompute from the asset table and overwrite.
 *
 * The counter is an optimisation over `SUM(bytes)`, so it must stay
 * reconstructible — otherwise a drift caused by a bug becomes permanent and
 * the optimisation is a commitment rather than a shortcut.
 *
 * Not called by the application. It exists for an operator with a
 * discrepancy, and as the thing the tests check incremental maintenance
 * against: if the deltas are right, this returns the same numbers.
 */
export async function recomputeUsage(
  db: Database,
  ctx: TenantContext,
): Promise<{ storageBytes: number; assetCount: number }> {
  return withTenant(db, ctx, async (tx) => {
    const rows = await tx
      .select({
        bytes: asset.bytes,
        variants: asset.variants,
        uploadedAt: asset.uploadedAt,
        deletedAt: asset.deletedAt,
      })
      .from(asset)
      .where(eq(asset.workspaceId, ctx.workspaceId))

    /**
     * Counted exactly when the bytes are really in storage: `uploaded_at`
     * is set, so a `pending` row with no object behind it does not count,
     * and the row is not soft-deleted.
     *
     * Both conditions are needed. Filtering on `uploaded_at` alone would
     * keep counting every deleted asset, because a soft delete does not
     * clear it — which is precisely the drift this function exists to
     * detect.
     */
    const live = rows.filter((row) => row.uploadedAt !== null && row.deletedAt === null)

    const totals = {
      storageBytes: live.reduce((sum, row) => sum + assetFootprint(row), 0),
      assetCount: live.length,
    }

    await tx
      .insert(workspaceUsage)
      .values({ workspaceId: ctx.workspaceId, ...totals })
      .onConflictDoUpdate({ target: workspaceUsage.workspaceId, set: totals })

    return totals
  })
}
