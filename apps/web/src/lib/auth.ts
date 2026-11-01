import 'server-only'

import { serverEnv } from '@pof/config/env'
import { createAuth, type Auth } from '@pof/auth'
import { buildResetEmail, createMail } from '@pof/core'
import type { MailPort } from '@pof/core/ports'

import { getDb } from './db.ts'

let instance: Auth | undefined
let mailInstance: MailPort | undefined

/**
 * The mail adapter, built once per process.
 *
 * Not per message: the SMTP adapter pools connections, so rebuilding it for
 * every reset would mean a TCP handshake, a TLS negotiation and an AUTH
 * round trip each time.
 */
function getMail(): MailPort {
  if (!mailInstance) {
    const env = serverEnv()
    mailInstance = createMail({
      provider: env.MAIL_PROVIDER,
      from: env.MAIL_FROM,
      smtp: {
        ...(env.SMTP_HOST ? { host: env.SMTP_HOST } : {}),
        ...(env.SMTP_PORT ? { port: env.SMTP_PORT } : {}),
        ...(env.SMTP_USER ? { user: env.SMTP_USER } : {}),
        ...(env.SMTP_PASSWORD ? { password: env.SMTP_PASSWORD } : {}),
      },
      ...(env.RESEND_API_KEY ? { resendApiKey: env.RESEND_API_KEY } : {}),
    })
  }
  return mailInstance
}

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

      /**
       * Failures are deliberately NOT swallowed. If the provider rejects the
       * message the request fails, because "check your inbox" over a mail
       * that was never sent is the worst possible outcome here.
       */
      sendResetPassword: async ({ to, url }) => {
        await getMail().send(buildResetEmail({ to, url }))
      },
    })
  }
  return instance
}
