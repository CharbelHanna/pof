import { serverEnv } from '@pof/config/env'
import { readVersion } from '@pof/core'
import { releaseName } from '@pof/schemas'

import { getDb } from '~/lib/db.ts'

/**
 * What is running, for deploy verification and bug reports.
 *
 * Unauthenticated on purpose. The whole value is answering "did the deploy
 * land, and is the worker on the same build" from a terminal or a probe,
 * neither of which has a session — requiring one would make it useless for
 * the job it exists to do.
 *
 * It exposes a build identifier and a liveness timestamp. Nothing here
 * describes a workspace, a user or a file, and the version is already
 * visible in the UI to anyone signed in.
 */
export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  const env = serverEnv()

  try {
    const report = await readVersion(getDb(), env.APP_VERSION)

    return Response.json(report, {
      /**
       * 200 even when the worker is missing. This endpoint reports on the
       * deployment; the web app answering is itself the success. A probe
       * that treated a dead worker as the web app being down would restart
       * the wrong container.
       */
      status: 200,
      headers: { 'cache-control': 'no-store' },
    })
  } catch {
    /**
     * The database is unreachable, so the worker's build is unknowable —
     * but this process still knows its own, and saying so is more useful
     * than a blank 500 when someone is trying to work out what is wrong.
     */
    return Response.json(
      {
        release: releaseName(env.APP_VERSION),
        web: env.APP_VERSION,
        worker: null,
        workerAlive: false,
        inSync: false,
      },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    )
  }
}
