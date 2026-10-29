import 'server-only'

import { serverEnv } from '@pof/config/env'
import { createAuth, type Auth } from '@pof/auth'

import { getDb } from './db.ts'

let instance: Auth | undefined

/**
 * Better Auth, constructed once per process.
 *
 * Lazy rather than module-level so that importing types from here does not
 * force environment validation during build-time static analysis.
 */
export function getAuth(): Auth {
  if (!instance) {
    const env = serverEnv()
    instance = createAuth({
      db: getDb(),
      secret: env.BETTER_AUTH_SECRET,
      baseURL: env.APP_URL,
      // APP_URL first and always: AUTH_TRUSTED_ORIGINS only ever widens the
      // set, so a misconfigured extra origin cannot lock out the real one.
      trustedOrigins: [env.APP_URL, ...env.AUTH_TRUSTED_ORIGINS],
    })
  }
  return instance
}
