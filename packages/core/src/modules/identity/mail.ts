import { createConsoleMail } from '../../adapters/console-mail.ts'
import { createResendMail } from '../../adapters/resend-mail.ts'
import { createSmtpMail } from '../../adapters/smtp-mail.ts'
import type { MailPort } from '../../ports/mail.ts'

/**
 * Choose a mail adapter from configuration.
 *
 * The single place a provider name is turned into an implementation, so
 * every caller depends on `MailPort` and nothing else. Adding a provider is
 * a new adapter plus one branch here.
 */

export interface MailConfig {
  provider: 'console' | 'smtp' | 'resend'
  from: string
  smtp?: { host?: string; port?: number; user?: string; password?: string }
  resendApiKey?: string
}

export function createMail(config: MailConfig): MailPort {
  switch (config.provider) {
    case 'smtp': {
      if (!config.smtp?.host) {
        // Also enforced in packages/config at boot. Repeated here because
        // this function is reachable from tests and scripts that build a
        // config by hand and would otherwise fail later, with a worse error.
        throw new Error('SMTP_HOST is required when MAIL_PROVIDER is "smtp"')
      }
      return createSmtpMail({
        host: config.smtp.host,
        // 587 is the submission port and the right default: 25 is
        // server-to-server and blocked by most networks, 465 is implicit TLS.
        port: config.smtp.port ?? 587,
        ...(config.smtp.user ? { user: config.smtp.user } : {}),
        ...(config.smtp.password ? { password: config.smtp.password } : {}),
        from: config.from,
      })
    }

    case 'resend': {
      if (!config.resendApiKey) {
        throw new Error('RESEND_API_KEY is required when MAIL_PROVIDER is "resend"')
      }
      return createResendMail({ apiKey: config.resendApiKey, from: config.from })
    }

    case 'console':
      return createConsoleMail({ from: config.from })
  }
}
