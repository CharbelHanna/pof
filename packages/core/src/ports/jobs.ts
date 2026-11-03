/**
 * ===========================================================================
 * JobQueuePort — handing work to the worker.
 * ===========================================================================
 *
 * The queue lives in Postgres (pg-boss), which is the whole reason the
 * deployment needs no Redis and no managed job platform. This port is not
 * about swapping that out — it is about keeping the *enqueue* side free of
 * it, so a service can say "process this asset" without the web app owning a
 * queue client's lifecycle, and so a test can assert what would have been
 * queued without running a worker.
 *
 * Every payload carries `workspaceId`, and that is not a convention — it is
 * the only thing standing between the worker and an unscoped query. A worker
 * has no request and therefore no session; a handler that cannot read the
 * workspace off its payload has nothing to open `withTenant` with.
 */

export interface JobPayload {
  /**
   * The tenant this work belongs to. Required on every job, with no default
   * and no "system" escape hatch, because a job that forgets it fails
   * closed and silently does nothing — which is harder to notice than a
   * crash.
   */
  workspaceId: string
  [key: string]: unknown
}

export interface EnqueueOptions {
  /**
   * Collapses duplicates: at most one queued job per key at a time.
   *
   * Confirming an upload twice, or a retried request, should not mean
   * rendering six derivatives twice.
   */
  singletonKey?: string
  /** Delay before the job becomes visible to a worker, in seconds. */
  startAfterSeconds?: number
}

export interface JobQueuePort {
  enqueue(name: string, payload: JobPayload, options?: EnqueueOptions): Promise<void>
}

/** Queue names, in one place so producer and consumer cannot drift. */
export const JOB_NAMES = {
  /** Render derivatives and extract metadata for one uploaded asset. */
  assetProcess: 'asset.process',
} as const
