/**
 * ===========================================================================
 * MailPort — sending transactional email, without naming a vendor.
 * ===========================================================================
 *
 * Expressed as intent ("deliver this message"), never in a provider's
 * vocabulary. No Resend `tags`, no nodemailer `Transport`, no SendGrid
 * personalisations. The moment one leaks through, that provider stops being
 * one implementation and becomes the design — and swapping it means touching
 * every call site instead of one adapter.
 *
 * Three adapters exist because each earns its place:
 *   - console — development. Writes the message to the log, including any
 *     link, so a password reset can be exercised with no account anywhere.
 *   - smtp    — the portability escape hatch. Works against Mailpit locally,
 *     and against Azure Communication Services, Postmark, Fastmail or a
 *     self-hosted relay in production. This is what keeps "no vendor
 *     commitment" true for mail.
 *   - resend  — the convenient default if you want an API key and nothing
 *     else to run.
 *
 * Delivery is fire-and-forget from the caller's perspective but NOT silent:
 * `send` resolves when the provider has accepted the message, and rejects if
 * it has not. A password reset that fails to send must be an error the caller
 * can see, because the alternative is a user staring at "check your inbox"
 * forever.
 */

export interface MailMessage {
  /** A single recipient. Bulk sending is not a thing this app needs. */
  to: string
  subject: string
  /**
   * Plain text body. Required, not optional — a text part is what keeps mail
   * out of spam filters and readable in clients that refuse HTML.
   */
  text: string
  /** Optional rich body. Clients that cannot render it fall back to `text`. */
  html?: string
  /**
   * Overrides the configured default sender. Rarely needed; exists so a
   * future per-workspace sending domain does not require a port change.
   */
  from?: string
  /** Where replies should go, when that differs from the sender. */
  replyTo?: string
}

export interface MailPort {
  /**
   * Deliver one message.
   *
   * Resolves once the provider has accepted it — which is not the same as
   * the recipient receiving it. No port can promise delivery; SPF, DKIM and
   * the receiving server decide that.
   *
   * Rejects when the provider refuses. Callers should let that surface
   * rather than swallow it.
   */
  send(message: MailMessage): Promise<void>

  /**
   * How this adapter identifies itself in logs and health output.
   *
   * Useful precisely because `console` silently discards mail: a deployment
   * can assert it is not running the development adapter.
   */
  readonly name: 'console' | 'smtp' | 'resend'
}
