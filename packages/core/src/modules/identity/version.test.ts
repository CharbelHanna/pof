import { createDatabase, schema, type Database } from '@pof/db'
import { testDatabaseUrls } from '@pof/db/testing'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { announceStart, readVersion, writeHeartbeat } from './version.service.ts'

/**
 * The heartbeat is about the deployment, not about a workspace — so unlike
 * every other suite here there is no tenant context, and the table has no
 * row-level security to work around.
 */

let db: Database
/**
 * A second connection as the schema owner, used only to reset between
 * tests.
 *
 * The application role is granted SELECT, INSERT and UPDATE on this table
 * and deliberately NOT DELETE — there is one row, upserted forever, and the
 * only reason to remove it would be a mistake. The first version of this
 * suite cleaned up through the app connection and every test failed on
 * `permission denied`, which is the grant doing exactly its job.
 *
 * Resetting as the owner keeps the production grant narrow instead of
 * widening it to suit a test.
 */
let owner: Database
let close: () => Promise<void>

beforeAll(async () => {
  const urls = testDatabaseUrls()
  const app = createDatabase(urls.appUrl, { max: 5 })
  const asOwner = createDatabase(urls.ownerUrl, { max: 2 })

  db = app.db
  owner = asOwner.db

  close = async () => {
    await app.client.end({ timeout: 5 })
    await asOwner.client.end({ timeout: 5 })
  }
})

afterAll(async () => {
  await close?.()
})

beforeEach(async () => {
  // One shared row, so each test needs a known starting state.
  await owner.delete(schema.workerHeartbeat)
})

/** Push the heartbeat into the past without waiting for real time. */
async function ageHeartbeat(minutes: number) {
  await db
    .update(schema.workerHeartbeat)
    .set({ lastSeenAt: sql`now() - interval '${sql.raw(String(minutes))} minutes'` })
    .where(eq(schema.workerHeartbeat.id, 'worker'))
}

describe('readVersion', () => {
  it('reports the web version even with no worker heartbeat', async () => {
    const report = await readVersion(db, 'v1.0.0')

    // A worker that has never run is a normal state on a fresh database,
    // not an error — the endpoint still has to answer.
    expect(report.web).toBe('v1.0.0')
    expect(report.worker).toBeNull()
    expect(report.workerAlive).toBe(false)
    expect(report.inSync).toBe(false)
  })

  it('reports both sides in sync when they match and the worker is alive', async () => {
    await announceStart(db, 'v1.0.0')

    const report = await readVersion(db, 'v1.0.0')

    expect(report.worker).toBe('v1.0.0')
    expect(report.workerAlive).toBe(true)
    expect(report.inSync).toBe(true)
  })

  /**
   * The skew this exists to make visible. Both images are built from one
   * commit, so a mismatch is either a deploy in progress or one that
   * stopped halfway — and because `migrate` runs from the worker image, a
   * lagging worker can mean a lagging schema.
   */
  it('reports out of sync when the worker is on a different build', async () => {
    await announceStart(db, 'v0.9.0')

    const report = await readVersion(db, 'v1.0.0')

    expect(report.web).toBe('v1.0.0')
    expect(report.worker).toBe('v0.9.0')
    expect(report.workerAlive).toBe(true)
    expect(report.inSync).toBe(false)
  })

  /**
   * The build id is `git describe` output, so it usually carries a commit
   * count and hash. Naming the release here means a consumer of this
   * endpoint — a deploy script, a status page — gets the answer rather than
   * re-implementing the parsing.
   */
  it('names the release alongside the full build id', async () => {
    const report = await readVersion(db, 'v0.5.0-3-gabc1234')

    expect(report.release).toBe('v0.5.0')
    expect(report.web).toBe('v0.5.0-3-gabc1234')
  })

  it('treats a stale heartbeat as a dead worker', async () => {
    await announceStart(db, 'v1.0.0')
    await ageHeartbeat(5)

    const report = await readVersion(db, 'v1.0.0')

    // Until now a dead worker was invisible: uploads would never become
    // `ready` and nothing anywhere would say why.
    expect(report.workerAlive).toBe(false)
    // Still reports which build it last was, which is what a bug report
    // needs even once the process is gone.
    expect(report.worker).toBe('v1.0.0')
  })

  it('is not in sync with a dead worker, even on a matching version', async () => {
    await announceStart(db, 'v1.0.0')
    await ageHeartbeat(5)

    // Agreeing with a version nobody is acting on is not agreement.
    expect((await readVersion(db, 'v1.0.0')).inSync).toBe(false)
  })
})

describe('writeHeartbeat', () => {
  it('refreshes liveness without moving the start time', async () => {
    await announceStart(db, 'v1.0.0')
    const [afterStart] = await db
      .select({ startedAt: schema.workerHeartbeat.startedAt })
      .from(schema.workerHeartbeat)

    await ageHeartbeat(5)
    await writeHeartbeat(db, 'v1.0.0')

    const [afterBeat] = await db
      .select({
        startedAt: schema.workerHeartbeat.startedAt,
        lastSeenAt: schema.workerHeartbeat.lastSeenAt,
      })
      .from(schema.workerHeartbeat)

    /**
     * `started_at` must keep meaning "when this process booted", so a
     * restart loop shows up as a moving value rather than a constant one.
     */
    expect(afterBeat!.startedAt.getTime()).toBe(afterStart!.startedAt.getTime())
    expect(await readVersion(db, 'v1.0.0').then((r) => r.workerAlive)).toBe(true)
    expect(afterBeat!.lastSeenAt.getTime()).toBeGreaterThan(afterStart!.startedAt.getTime() - 1)
  })

  it('records a new build when the worker is redeployed', async () => {
    await announceStart(db, 'v1.0.0')
    await announceStart(db, 'v1.1.0')

    const report = await readVersion(db, 'v1.1.0')

    // One row, upserted — a redeploy replaces the record rather than
    // accumulating one per restart.
    expect(report.worker).toBe('v1.1.0')
    expect(report.inSync).toBe(true)
  })
})
