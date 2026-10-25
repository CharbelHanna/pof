import { serverEnv } from '@pof/config/env'
// Named export: pg-boss dropped its default export in v12.
import { PgBoss } from 'pg-boss'

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
  console.log('[worker] started; no queues registered yet (Phase 2 adds the first)')

  const shutdown = async (signal: string) => {
    console.log(`[worker] ${signal} received, draining…`)
    // Lets in-flight jobs finish rather than abandoning them mid-write, which
    // matters for the image pipeline where a half-written derivative would
    // leave an asset stuck in `processing`.
    await boss.stop({ graceful: true })
    process.exit(0)
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

main().catch((error: unknown) => {
  console.error('[worker] failed to start:', error)
  process.exit(1)
})
