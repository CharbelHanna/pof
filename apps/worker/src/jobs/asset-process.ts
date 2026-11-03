import { processAsset } from '@pof/core'
import { JOB_NAMES } from '@pof/core/ports'
import type { ImagePort, StoragePort } from '@pof/core/ports'
import type { Database } from '@pof/db'
import type { PgBoss } from 'pg-boss'

/**
 * The `asset.process` consumer.
 *
 * A thin adapter, exactly like an oRPC procedure: read the payload, build a
 * tenant context, call `@pof/core`, map the outcome. No business rules live
 * here — what sizes to render and when an asset becomes `ready` belong in
 * the service, where they can be tested without a queue.
 */

interface AssetProcessPayload {
  workspaceId?: unknown
  assetId?: unknown
}

export async function registerAssetProcess(
  boss: PgBoss,
  deps: { db: Database; storage: StoragePort; image: ImagePort },
) {
  /**
   * pg-boss 10 made queues explicit: `work()` and `send()` both fail with
   * PGBOSS_QUEUE_NOT_FOUND against a queue that was never created. It is
   * idempotent, so calling it on every start is the simplest way to keep a
   * fresh database and an existing one on the same path.
   */
  await boss.createQueue(JOB_NAMES.assetProcess)

  return boss.work<AssetProcessPayload>(
    JOB_NAMES.assetProcess,
    {
      /**
       * Two at a time. Each job holds a whole original plus a render in
       * memory, so this is a memory ceiling rather than a throughput knob —
       * six concurrent 50MB files would be a container restart.
       */
      batchSize: 2,
      pollingIntervalSeconds: 2,
    },
    async (jobs) => {
      for (const job of jobs) {
        const { workspaceId, assetId } = job.data

        /**
         * The payload is data from a table, not a typed call. A job queued
         * by an older version, or by hand, can be missing either field —
         * and a handler that trusted them would open `withTenant` with
         * `undefined` and silently touch nothing.
         */
        if (typeof workspaceId !== 'string' || typeof assetId !== 'string') {
          console.error('[worker] asset.process: malformed payload', job.data)
          continue
        }

        /**
         * The tenant context is built from the payload because a worker has
         * no request and no session. `userId` is the asset's workspace
         * rather than a person: nothing in the processing path attributes
         * anything to a user, and inventing one would be a lie that audit
         * logging would later repeat.
         */
        const result = await processAsset(
          deps.db,
          { workspaceId, userId: workspaceId },
          deps.storage,
          deps.image,
          assetId,
        )

        if (result.status === 'failed') {
          /**
           * Logged but NOT rethrown. The failure is already recorded on the
           * row with a reason the user can see, so letting pg-boss retry
           * would re-render a file that will fail the same way — six times,
           * with backoff. A genuinely transient fault (storage unreachable)
           * throws out of processAsset instead and does get retried.
           */
          console.error(`[worker] asset.process: ${assetId} failed — ${result.failureReason}`)
        }
      }
    },
  )
}
