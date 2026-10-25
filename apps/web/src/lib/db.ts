import 'server-only'

import { serverEnv } from '@pof/config/env'
import { sharedDatabase, type Database } from '@pof/db'

/**
 * The process-wide database connection.
 *
 * `server-only` makes importing this from a client component a build error
 * rather than a runtime surprise — this module reads secrets from the
 * environment and must never reach the browser bundle.
 */
export function getDb(): Database {
  return sharedDatabase(serverEnv().DATABASE_URL).db
}
