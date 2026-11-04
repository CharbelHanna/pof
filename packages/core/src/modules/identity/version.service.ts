import { desc, eq, sql } from 'drizzle-orm'
import { schema, type Database } from '@pof/db'
import { releaseName } from '@pof/schemas'

/**
 * Which build is running, on both sides.
 *
 * Deliberately outside `withTenant`: the heartbeat belongs to the
 * deployment, not to a workspace, and is read when answering "what is
 * running" — a question that has no tenant. It is also the one table the
 * web app reads with no session at all, for the public version endpoint.
 */

const { workerHeartbeat } = schema

/** The single row's key. See the schema for why there is only one. */
const ROW_ID = 'worker'

/**
 * How long a heartbeat stays believable.
 *
 * Generously longer than the write interval, so an ordinary pause — a long
 * image render holding the loop, a slow query — is not reported as death.
 * The signal worth having is "gone", not "busy".
 */
const STALE_AFTER_MS = 2 * 60 * 1000

export interface VersionReport {
  /**
   * The release the web app is on, as shown in the interface.
   *
   * Reported alongside the full build id so a consumer does not have to
   * parse `git describe` output to find out what to call this version.
   */
  release: string
  web: string
  worker: string | null
  workerLastSeenAt: Date | null
  /** False when the heartbeat is older than the staleness window, or absent. */
  workerAlive: boolean
  /**
   * True when both sides report the same build.
   *
   * They are built from one commit and should always match. A mismatch is
   * either a deploy in progress — transient, expected — or a partial one
   * that stopped halfway. Worth surfacing rather than inferring, because
   * `migrate` runs from the worker image: a worker behind the web app means
   * the schema may be behind too.
   */
  inSync: boolean
}

export async function readVersion(db: Database, webVersion: string): Promise<VersionReport> {
  const [row] = await db
    .select({
      version: workerHeartbeat.version,
      lastSeenAt: workerHeartbeat.lastSeenAt,
    })
    .from(workerHeartbeat)
    .where(eq(workerHeartbeat.id, ROW_ID))
    .orderBy(desc(workerHeartbeat.lastSeenAt))
    .limit(1)

  const workerAlive = row ? Date.now() - row.lastSeenAt.getTime() < STALE_AFTER_MS : false

  return {
    release: releaseName(webVersion),
    web: webVersion,
    worker: row?.version ?? null,
    workerLastSeenAt: row?.lastSeenAt ?? null,
    workerAlive,
    // Never "in sync" with a worker that is not running: agreeing with a
    // version nobody is acting on is not agreement.
    inSync: workerAlive && row?.version === webVersion,
  }
}

/** Record that this worker is alive and which build it is. */
export async function writeHeartbeat(db: Database, version: string): Promise<void> {
  await db
    .insert(workerHeartbeat)
    .values({ id: ROW_ID, version, startedAt: new Date(), lastSeenAt: new Date() })
    .onConflictDoUpdate({
      target: workerHeartbeat.id,
      set: {
        version,
        lastSeenAt: sql`now()`,
        // `started_at` is deliberately left alone on update, so it keeps
        // meaning "when this process booted" and a restart loop is visible
        // as a moving value rather than a constant one.
      },
    })
}

/** Set `started_at` too — called once, when the process boots. */
export async function announceStart(db: Database, version: string): Promise<void> {
  await db
    .insert(workerHeartbeat)
    .values({ id: ROW_ID, version, startedAt: new Date(), lastSeenAt: new Date() })
    .onConflictDoUpdate({
      target: workerHeartbeat.id,
      set: { version, startedAt: sql`now()`, lastSeenAt: sql`now()` },
    })
}
