import 'server-only'

import { serverEnv } from '@pof/config/env'
import { JOB_NAMES, type EnqueueOptions, type JobPayload, type JobQueuePort } from '@pof/core/ports'
import { PgBoss } from 'pg-boss'

/**
 * The queue, from the producing side only.
 *
 * The web app sends jobs; it never runs them. That distinction is what the
 * options below encode — without them this process would start pg-boss's
 * maintenance and scheduling loops too, duplicating work the worker already
 * does and competing with it for the same rows.
 *
 * Started lazily and kept for the life of the process, because `send()`
 * needs a started instance and starting one per request would mean a
 * connection and a handshake per upload.
 */

let boss: PgBoss | undefined
let starting: Promise<PgBoss> | undefined

async function getBoss(): Promise<PgBoss> {
  if (boss) return boss

  /**
   * Two uploads confirming at once would otherwise both see no instance and
   * both call `start()`. Holding the promise rather than the result means
   * the second await the first.
   */
  starting ??= (async () => {
    const env = serverEnv()

    const instance = new PgBoss({
      connectionString: env.DATABASE_URL,
      schema: 'pgboss',
      // Owned by migration 0002; the app role cannot CREATE on the database.
      createSchema: false,
      /**
       * Producer only. The worker supervises the queue and runs the cron;
       * a second supervisor would archive and retry the same jobs from a
       * process that has no handlers registered.
       */
      supervise: false,
      schedule: false,
      // One connection is ample for inserting a row per upload.
      max: 2,
    })

    instance.on('error', (error: unknown) => {
      console.error('[jobs] pg-boss error:', error)
    })

    await instance.start()

    /**
     * Also created here, not only in the worker. Queues are explicit in
     * pg-boss 10 and above, and `send()` to one that does not exist throws
     * PGBOSS_QUEUE_NOT_FOUND — so a web process that starts before the
     * worker ever has would refuse uploads for a reason the user cannot
     * act on. Idempotent, so both creating it is harmless.
     */
    await Promise.all(Object.values(JOB_NAMES).map((name) => instance.createQueue(name)))

    boss = instance
    return instance
  })()

  return starting
}

export function getJobQueue(): JobQueuePort {
  return {
    async enqueue(name: string, payload: JobPayload, options?: EnqueueOptions): Promise<void> {
      const instance = await getBoss()

      await instance.send(name, payload, {
        ...(options?.singletonKey ? { singletonKey: options.singletonKey } : {}),
        ...(options?.startAfterSeconds ? { startAfter: options.startAfterSeconds } : {}),
      })
    },
  }
}
