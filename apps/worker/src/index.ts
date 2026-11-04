import { serverEnv } from '@pof/config/env'
import { announceStart, createS3Storage, writeHeartbeat } from '@pof/core'
import { createDatabase } from '@pof/db'
// Named export: pg-boss dropped its default export in v12.
import { PgBoss } from 'pg-boss'

import { createSharpImage } from './image.ts'
import { registerAssetProcess } from './jobs/asset-process.ts'

/**
 * Background worker.
 *
 * A long-running container, deliberately — not a serverless function. That
 * choice is what keeps the deployment shape portable: queue, retries, dead
 * letters AND cron all live inside the Postgres we already run, so there is
 * no Redis, no Inngest/Trigger.dev account, and no platform scheduler to
 * depend on. "Refresh the weather 24h before a session" is a row in our own
 * database, not a Vercel Cron entry or an Azure Timer Trigger.
 *
 * Phase 0 ships the process and its lifecycle only. The jobs arrive with the
 * features that need them:
 *   Phase 2  asset.process  — sharp derivatives, EXIF extraction
 *   Phase 5  weather.refresh — cron at T-72h / T-24h / T-3h per session
 *   Phase 6  deliverable.remind — due-date emails
 *
 * ---------------------------------------------------------------------------
 * Tenancy warning for whoever adds the first real job.
 * ---------------------------------------------------------------------------
 * A worker has no request and therefore no session. This is the single most
 * likely place for a cross-tenant leak in this codebase: every job payload
 * MUST carry `workspaceId`, and every handler MUST open `withTenant` before
 * touching domain tables. A handler that grabs a raw connection runs
 * unscoped — row-level security will return nothing rather than everything
 * (it fails closed), but the job will silently do nothing, which is its own
 * kind of bug.
 */

async function main(): Promise<void> {
  const env = serverEnv()

  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    // Its own schema, so queue tables never collide with the application
    // schema or its RLS policies.
    schema: 'pgboss',
    /**
     * The schema is created by migration 0002, not by pg-boss.
     *
     * The application role has no CREATE privilege on the database — that is
     * deliberate, and is what keeps row-level security meaningful for it.
     * pg-boss would otherwise issue `CREATE SCHEMA IF NOT EXISTS`, and
     * Postgres checks database-level CREATE *before* the IF NOT EXISTS
     * short-circuits, so it fails even though the schema already exists.
     *
     * The migration grants app_user ownership of that one schema, so pg-boss
     * can still create and migrate its tables inside it — and nowhere else.
     */
    createSchema: false,
  })

  boss.on('error', (error: unknown) => {
    console.error('[worker] pg-boss error:', error)
  })

  await boss.start()

  /**
   * One database handle and one storage client for the process, not per
   * job. Both pool connections; rebuilding them per image would add a
   * handshake to every render.
   *
   * The app role, not the owner — the worker is subject to the same
   * row-level security as a request, which is what makes `withTenant` in
   * the handlers meaningful rather than decorative.
   */
  const { db, client } = createDatabase(env.DATABASE_URL, { max: 5 })

  const storage = createS3Storage({
    bucket: env.STORAGE_BUCKET,
    region: env.STORAGE_REGION,
    accessKeyId: env.STORAGE_ACCESS_KEY_ID,
    secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY,
    ...(env.STORAGE_ENDPOINT ? { endpoint: env.STORAGE_ENDPOINT } : {}),
    forcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
  })

  await registerAssetProcess(boss, { db, storage, image: createSharpImage() })

  /**
   * Say which build this is, and keep saying it.
   *
   * The worker has no HTTP surface, so a row is how anything learns both
   * that it is alive and what it is running. Until now a dead worker was
   * invisible: uploads would simply never become `ready`, with nothing
   * anywhere saying why.
   */
  await announceStart(db, env.APP_VERSION)
  console.log(`[worker] started ${env.APP_VERSION}; asset.process registered`)

  /**
   * Comfortably more often than the staleness window, so an ordinary pause
   * — a long render holding the loop — never reads as death.
   *
   * `unref` so a pending timer cannot keep the process alive during a
   * graceful shutdown, which would turn a clean stop into a 30-second wait
   * for the orchestrator to lose patience.
   */
  const heartbeat = setInterval(() => {
    void writeHeartbeat(db, env.APP_VERSION).catch((error: unknown) => {
      // Logged, never thrown: failing to report liveness must not stop the
      // worker actually doing work.
      console.error('[worker] heartbeat failed:', error)
    })
  }, 30_000)
  heartbeat.unref()

  const shutdown = async (signal: string) => {
    console.log(`[worker] ${signal} received, draining…`)
    // Lets in-flight jobs finish rather than abandoning them mid-write, which
    // matters for the image pipeline where a half-written derivative would
    // leave an asset stuck in `processing`.
    clearInterval(heartbeat)
    await boss.stop({ graceful: true })
    await client.end({ timeout: 5 })
    process.exit(0)
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

main().catch((error: unknown) => {
  console.error('[worker] failed to start:', error)
  process.exit(1)
})
