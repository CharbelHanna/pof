import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * What the worker is running, and whether it is running at all.
 *
 * The worker has no HTTP surface — deliberately, since it is a queue
 * consumer rather than a server — so this table is how it answers two
 * questions nothing could answer before: which build is processing jobs,
 * and is anything processing them.
 *
 * ---------------------------------------------------------------------------
 * NOT tenant-scoped, and deliberately absent from `tenantTables`
 * ---------------------------------------------------------------------------
 * This is infrastructure, not someone's data: there is no `workspace_id`
 * and nothing to isolate, the same reasoning that keeps `shoot_type` out.
 * It therefore needs explicit grants rather than the row-level security
 * helper — see the migration.
 *
 * A single row, keyed by a constant. The deployment runs one worker (its
 * replica count is pinned at 1 because pg-boss polls), and if a second ever
 * ran they would both write the same version from the same release, so the
 * row would stay truthful about the build and merely race on `last_seen`.
 */
export const workerHeartbeat = pgTable('worker_heartbeat', {
  /** Always `worker`. A primary key so the upsert has a conflict target. */
  id: text('id').primaryKey().default('worker'),

  /** The build identifier, matching what the web app reports for itself. */
  version: text('version').notNull(),

  /** When this worker process started — a restart loop shows up here. */
  startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),

  /**
   * Refreshed periodically. Staleness is the liveness signal: a heartbeat
   * minutes old means the worker is gone, which until now was invisible —
   * uploads would simply never become `ready` and nothing would say why.
   */
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
})

export type WorkerHeartbeat = typeof workerHeartbeat.$inferSelect
