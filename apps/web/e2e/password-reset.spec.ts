import { expect, test, type Page } from '@playwright/test'

/**
 * Password reset, end to end through real SMTP.
 *
 * The mail is not mocked. The app sends to the Mailpit container in
 * docker-compose, and this reads it back out of Mailpit's HTTP API and
 * follows the link it actually contains. That makes it a test of the whole
 * chain — Better Auth's token, the mail adapter, the message body, the
 * redirect, the token exchange — rather than a test that a function was
 * called.
 *
 * The one piece it cannot cover is whether a real provider delivers to a
 * real inbox. Nothing automated can; that is SPF, DKIM and DMARC.
 */

/** Mailpit's API, on the host rather than the compose network. */
const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025'

function uniqueEmail(): string {
  return `reset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@pof.test`
}

async function signUp(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/sign-up')
  await page.getByLabel('Name').fill('Reset Tester')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/shoots$/, { timeout: 30_000 })
}

interface MailpitMessage {
  ID: string
  To: { Address: string }[]
  Subject: string
}

/**
 * Mail is sent in the background relative to the HTTP response, so poll
 * rather than assuming it has arrived. Searching by recipient keeps parallel
 * workers from reading each other's mail.
 */
async function waitForMail(page: Page, to: string): Promise<MailpitMessage> {
  const deadline = Date.now() + 20_000

  while (Date.now() < deadline) {
    const response = await page.request.get(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`,
    )
    if (response.ok()) {
      const body = (await response.json()) as { messages?: MailpitMessage[] }
      const found = body.messages?.[0]
      if (found) return found
    }
    await page.waitForTimeout(500)
  }

  throw new Error(`No mail arrived for ${to} within 20s`)
}

async function resetLinkFor(page: Page, to: string): Promise<string> {
  const message = await waitForMail(page, to)
  const response = await page.request.get(`${MAILPIT}/api/v1/message/${message.ID}`)
  const body = (await response.json()) as { Text: string }

  const link = /http:\/\/[^\s<>"]+reset-password\/[^\s<>"]+/.exec(body.Text)?.[0]
  if (!link) throw new Error(`No reset link in the email body:\n${body.Text}`)
  return link
}

test('a photographer who forgot their password can set a new one', async ({ page }) => {
  const email = uniqueEmail()
  await signUp(page, email, 'original-password-123')

  // Sign out so the reset is exercised from a logged-out state, which is the
  // only state it is ever used from.
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/sign-in$/)

  // The link has to be reachable, not merely to exist.
  await page.getByRole('link', { name: 'Forgot your password?' }).click()
  await expect(page).toHaveURL(/\/forgot-password$/)

  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Send reset link' }).click()
  await expect(page.getByText(/a reset link is on its way/i)).toBeVisible()

  // Follow the link from the email itself, rather than constructing one.
  await page.goto(await resetLinkFor(page, email))
  await expect(page).toHaveURL(/\/reset-password\?token=/)

  await page.getByLabel('New password', { exact: true }).fill('a-brand-new-password-456')
  await page.getByLabel('Confirm new password').fill('a-brand-new-password-456')
  await page.getByRole('button', { name: 'Set new password' }).click()

  await expect(page).toHaveURL(/\/sign-in$/)

  // The actual point: the new password works.
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('a-brand-new-password-456')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/shoots$/, { timeout: 30_000 })
})

test('the old password stops working after a reset', async ({ page }) => {
  const email = uniqueEmail()
  await signUp(page, email, 'original-password-123')
  await page.getByRole('button', { name: 'Sign out' }).click()

  await page.goto('/forgot-password')
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Send reset link' }).click()
  await expect(page.getByText(/a reset link is on its way/i)).toBeVisible()

  await page.goto(await resetLinkFor(page, email))
  await page.getByLabel('New password', { exact: true }).fill('a-brand-new-password-456')
  await page.getByLabel('Confirm new password').fill('a-brand-new-password-456')
  await page.getByRole('button', { name: 'Set new password' }).click()
  await expect(page).toHaveURL(/\/sign-in$/)

  // A reset that left the old password working would be worse than no reset
  // at all — the user would believe they had locked an attacker out.
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('original-password-123')
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page).toHaveURL(/\/sign-in$/)
})

test('an unknown address is told the same thing as a known one', async ({ page }) => {
  // Otherwise this form becomes a way to test whether someone has an account
  // here, which for a boudoir photographer's client list is a real problem.
  await page.goto('/forgot-password')
  await page.getByLabel('Email').fill(`definitely-not-registered-${Date.now()}@pof.test`)
  await page.getByRole('button', { name: 'Send reset link' }).click()

  await expect(page.getByText(/a reset link is on its way/i)).toBeVisible()
})

test('a reset link cannot be used twice', async ({ page }) => {
  const email = uniqueEmail()
  await signUp(page, email, 'original-password-123')
  await page.getByRole('button', { name: 'Sign out' }).click()

  await page.goto('/forgot-password')
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Send reset link' }).click()
  await expect(page.getByText(/a reset link is on its way/i)).toBeVisible()

  const link = await resetLinkFor(page, email)

  await page.goto(link)
  await page.getByLabel('New password', { exact: true }).fill('a-brand-new-password-456')
  await page.getByLabel('Confirm new password').fill('a-brand-new-password-456')
  await page.getByRole('button', { name: 'Set new password' }).click()
  await expect(page).toHaveURL(/\/sign-in$/)

  // A link that still worked after use would mean anyone who later read the
  // mailbox could take the account.
  await page.goto(link)
  await expect(page.getByText(/no longer valid/i)).toBeVisible()
})

test('mismatched confirmation is caught before the request', async ({ page }) => {
  const email = uniqueEmail()
  await signUp(page, email, 'original-password-123')
  await page.getByRole('button', { name: 'Sign out' }).click()

  await page.goto('/forgot-password')
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Send reset link' }).click()
  await expect(page.getByText(/a reset link is on its way/i)).toBeVisible()

  await page.goto(await resetLinkFor(page, email))
  await page.getByLabel('New password', { exact: true }).fill('a-brand-new-password-456')
  await page.getByLabel('Confirm new password').fill('a-different-password-789')
  await page.getByRole('button', { name: 'Set new password' }).click()

  // A typo that silently became the real password would lock someone out of
  // their own account, with a valid reset link already spent.
  await expect(page.getByText(/do not match/i)).toBeVisible()
  await expect(page).toHaveURL(/\/reset-password/)
})
