import type { MailMessage } from '../../ports/mail.ts'

/**
 * The password reset email.
 *
 * A pure function from (recipient, link) to a message, with no transport and
 * no I/O, so the wording and the escaping can be tested without sending
 * anything.
 *
 * Deliberately plain. A reset email has one job — carry one link — and the
 * more it looks like marketing, the more likely a spam filter treats it that
 * way. Both a text and an HTML part are produced because a text part is
 * expected by filters and is what some clients will show.
 */

/** Matches the token lifetime Better Auth is configured with. */
const EXPIRY_TEXT = 'This link stops working in one hour.'

export function buildResetEmail(options: { to: string; url: string }): MailMessage {
  const { to, url } = options

  const text = [
    'Someone asked to reset the password for your Point of Focus account.',
    '',
    'Open this link to choose a new one:',
    url,
    '',
    EXPIRY_TEXT,
    '',
    "If this wasn't you, ignore this email — your password stays as it is.",
  ].join('\n')

  const html = [
    '<!doctype html>',
    '<html lang="en">',
    '<body style="font-family: system-ui, sans-serif; line-height: 1.5; color: #1a1a1a;">',
    '<p>Someone asked to reset the password for your Point of Focus account.</p>',
    `<p><a href="${escapeHtml(url)}">Choose a new password</a></p>`,
    /**
     * The raw URL as well as the link: mail clients routinely strip or
     * rewrite anchors, and a visible URL can still be copied by hand.
     */
    `<p style="color:#666; font-size: 13px; word-break: break-all;">${escapeHtml(url)}</p>`,
    `<p style="color:#666; font-size: 13px;">${EXPIRY_TEXT}</p>`,
    '<p style="color:#666; font-size: 13px;">If this wasn’t you, ignore this email — your password stays as it is.</p>',
    '</body>',
    '</html>',
  ].join('\n')

  return {
    to,
    subject: 'Reset your Point of Focus password',
    text,
    html,
  }
}

/**
 * The URL is built from APP_URL and a generated token, so it is not
 * attacker-controlled — but it is interpolated into markup, and "this input
 * is safe today" is exactly the assumption that stops being true later.
 */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
