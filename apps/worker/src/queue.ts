import type { EnqueueOptions, JobPayload, JobQueuePort } from '@pof/core/ports'
import type { PgBoss } from 'pg-boss'

/** `JobQueuePort` over an already-started pg-boss instance. */
export function createPgBossQueue(boss: PgBoss): JobQueuePort {
  return {
    async enqueue(name: string, payload: JobPayload, options?: EnqueueOptions): Promise<void> {
      await boss.send(name, payload, {
        ...(options?.singletonKey ? { singletonKey: options.singletonKey } : {}),
        ...(options?.startAfterSeconds ? { startAfter: options.startAfterSeconds } : {}),
      })
    },
  }
}
