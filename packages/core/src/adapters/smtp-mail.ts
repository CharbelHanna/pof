import nodemailer, { type Transporter } from 'nodemailer'

import type { MailMessage, MailPort } from '../ports/mail.ts'

/**
 * SMTP — the portability escape hatch for mail.
 *
 * This is the adapter that keeps "no vendor commitment" true. The same code
 * runs against Mailpit on a laptop, Azure Communication Services, Postmark,
 * Fastmail, or a relay in a cupboard, by changing four environment variables.
 * Nothing above this file knows which.
 *
 * The transport is created once and reused. Nodemailer pools connections, and
 * building a transport per message would mean a TCP handshake, a TLS
 * negotiation and an AUTH round trip for every password reset.
 */

export interface SmtpOptions {
  host: string
  port: number
  user?: string
  password?: string
  from: string
  /**
   * Whether to use implicit TLS, as on port 465. Defaults to true for 465
   * and false otherwise, which is what nearly every provider expects:
   * 587 and 25 start in the clear and upgrade with STARTTLS.
   */
  secure?: boolean
}

export function createSmtpMail(options: SmtpOptions): MailPort {
  let transport: Transporter | undefined

  function getTransport(): Transporter {
    transport ??= nodemailer.createTransport({
      host: options.host,
      port: options.port,
      secure: options.secure ?? options.port === 465,
      /**
       * Omitted entirely when absent rather than passed as undefined.
       * Mailpit and other local catchers accept no credentials at all, and
       * an empty auth object makes nodemailer attempt AUTH and fail.
       */
      ...(options.user ? { auth: { user: options.user, pass: options.password ?? '' } } : {}),
    })
    return transport
  }

  return {
    name: 'smtp',

    async send(message: MailMessage): Promise<void> {
      await getTransport().sendMail({
        from: message.from ?? options.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
        ...(message.replyTo ? { replyTo: message.replyTo } : {}),
      })
    },
  }
}
