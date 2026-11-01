import type { MailMessage, MailPort } from '../ports/mail.ts'

/**
 * Resend, over its REST API rather than its SDK.
 *
 * `fetch` for the same reason the geocoding adapters use it: the request is
 * one POST with a JSON body, and taking an SDK for that buys a dependency,
 * its transitive tree and its release cadence in exchange for nothing. It
 * also keeps this file honest — everything Resend-specific is visible here
 * instead of hidden behind a client object.
 */

export interface ResendOptions {
  apiKey: string
  from: string
  /** Override for testing. */
  baseUrl?: string
  fetch?: typeof globalThis.fetch
}

export function createResendMail(options: ResendOptions): MailPort {
  const baseUrl = options.baseUrl ?? 'https://api.resend.com'
  const doFetch = options.fetch ?? globalThis.fetch

  return {
    name: 'resend',

    async send(message: MailMessage): Promise<void> {
      const response = await doFetch(new URL('/emails', baseUrl), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: message.from ?? options.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          ...(message.html ? { html: message.html } : {}),
          ...(message.replyTo ? { reply_to: message.replyTo } : {}),
        }),
      })

      if (!response.ok) {
        /**
         * The body carries the actual reason — an unverified sending domain
         * is the usual one, and "Mail delivery failed (403)" alone would
         * send someone hunting through the wrong logs for an afternoon.
         */
        const detail = await response.text().catch(() => '')
        throw new Error(
          `Resend rejected the message (${response.status})${detail ? `: ${detail}` : ''}`,
        )
      }
    },
  }
}
