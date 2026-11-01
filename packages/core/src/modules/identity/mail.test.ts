import { describe, expect, it, vi } from 'vitest'

import { createResendMail } from '../../adapters/resend-mail.ts'
import { createMail } from './mail.ts'
import { buildResetEmail } from './reset-email.ts'

/**
 * Pure units only — no SMTP, no network. The adapters are exercised for real
 * by the end-to-end suite, which sends through Mailpit and reads the result
 * back out of its inbox.
 */

describe('buildResetEmail', () => {
  const url = 'http://localhost:3000/api/auth/reset-password/tok123?callbackURL=%2Freset-password'

  it('puts the link in both the text and the html part', () => {
    const message = buildResetEmail({ to: 'alex@studio.com', url })

    expect(message.to).toBe('alex@studio.com')
    expect(message.text).toContain(url)
    expect(message.html).toContain(url)
  })

  it('always has a text part', () => {
    // Spam filters expect one, and some clients will only show it.
    const message = buildResetEmail({ to: 'alex@studio.com', url })

    expect(message.text.length).toBeGreaterThan(0)
  })

  it('says the link expires', () => {
    const message = buildResetEmail({ to: 'alex@studio.com', url })

    expect(message.text).toMatch(/one hour/i)
  })

  it('tells a recipient who did not ask that they can ignore it', () => {
    // The single most important line in the email: most people receiving one
    // unexpectedly are worried, not locked out.
    const message = buildResetEmail({ to: 'alex@studio.com', url })

    expect(message.text).toMatch(/ignore this email/i)
  })

  it('escapes the url in the html part', () => {
    // The URL is built from APP_URL and a generated token, so it is not
    // attacker-controlled today. This pins the escaping so that stays true
    // if the link ever carries something a user supplied.
    const nasty = 'http://localhost:3000/r/"><script>alert(1)</script>'
    const message = buildResetEmail({ to: 'alex@studio.com', url: nasty })

    expect(message.html).not.toContain('<script>')
    expect(message.html).toContain('&lt;script&gt;')
  })
})

describe('createMail', () => {
  it('returns the console adapter by default', () => {
    expect(createMail({ provider: 'console', from: 'noreply@pof.local' }).name).toBe('console')
  })

  it('refuses smtp without a host', () => {
    // Better to fail here than to construct a transport that times out on
    // the first password reset someone actually needs.
    expect(() => createMail({ provider: 'smtp', from: 'noreply@pof.local' })).toThrow(/SMTP_HOST/)
  })

  it('refuses resend without an api key', () => {
    expect(() => createMail({ provider: 'resend', from: 'noreply@pof.local' })).toThrow(
      /RESEND_API_KEY/,
    )
  })

  it('builds an smtp adapter when a host is given', () => {
    const mail = createMail({
      provider: 'smtp',
      from: 'noreply@pof.local',
      smtp: { host: 'mail', port: 1025 },
    })

    expect(mail.name).toBe('smtp')
  })
})

describe('resend adapter', () => {
  const message = { to: 'alex@studio.com', subject: 'Hi', text: 'Hello' }

  it('posts the message and resolves when accepted', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{"id":"abc"}', { status: 200 }))
    const mail = createResendMail({ apiKey: 'key', from: 'noreply@pof.local', fetch })

    await expect(mail.send(message)).resolves.toBeUndefined()

    const [, init] = fetch.mock.calls[0]!
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer key')
    expect(JSON.parse(init.body).to).toEqual(['alex@studio.com'])
  })

  it('surfaces the provider’s reason for a rejection', async () => {
    // An unverified sending domain is the usual cause, and a bare "403"
    // sends someone hunting through the wrong logs for an afternoon.
    const fetch = vi.fn().mockResolvedValue(new Response('domain is not verified', { status: 403 }))
    const mail = createResendMail({ apiKey: 'key', from: 'noreply@pof.local', fetch })

    await expect(mail.send(message)).rejects.toThrow(/403.*domain is not verified/)
  })
})
