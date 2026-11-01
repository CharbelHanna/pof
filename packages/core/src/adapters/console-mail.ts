import type { MailMessage, MailPort } from '../ports/mail.ts'

/**
 * Writes mail to the log instead of sending it.
 *
 * The development default, and the reason a password reset can be exercised
 * on a laptop with no account at any provider: the reset link appears in
 * `docker compose logs web`.
 *
 * It DISCARDS mail, which is why `packages/config` refuses to boot when this
 * is selected for a deployed app. Forgetting to configure a real provider
 * would otherwise look exactly like working software until someone needed a
 * password reset.
 *
 * Prefer Mailpit (the smtp adapter against the local container) when working
 * on the mail itself — it exercises the real path and renders the HTML. This
 * one is for when you want zero moving parts.
 */
export function createConsoleMail(
  options: { from: string } = { from: 'noreply@pof.local' },
): MailPort {
  return {
    name: 'console',

    async send(message: MailMessage): Promise<void> {
      const lines = [
        '─── mail (not sent — console adapter) ───',
        `from:    ${message.from ?? options.from}`,
        `to:      ${message.to}`,
        `subject: ${message.subject}`,
        ...(message.replyTo ? [`reply-to: ${message.replyTo}`] : []),
        '',
        message.text,
        '─────────────────────────────────────────',
      ]

      // console rather than a logger: this is a development aid whose entire
      // job is to be visible in `docker compose logs`, and structured JSON
      // would bury the link inside an escaped string.
      console.info(lines.join('\n'))
    },
  }
}
