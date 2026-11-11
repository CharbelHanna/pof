import { expect, test, type Page } from '@playwright/test'

/**
 * The app used over plain HTTP, which is how it is used on a phone.
 *
 * `crypto.randomUUID()` exists only in a secure context — HTTPS, or
 * localhost. Reaching the dev stack from a handset means hitting the host's
 * LAN IP over http://, where the function is simply `undefined` and calling
 * it throws. The whole suite otherwise runs on localhost, so this class of
 * bug is invisible to it: the one place it crept in shipped in v0.6.0 and was
 * found by a person with a phone, not by CI.
 *
 * Removing the function reproduces that environment exactly, without needing
 * a second machine or a certificate.
 */

function uniqueEmail(): string {
  return `insecure-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@pof.test`
}

async function asInsecureContext(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(globalThis.crypto, 'randomUUID', {
      configurable: true,
      value: undefined,
    })
  })
}

test('a template can be filled in without crypto.randomUUID', async ({ page }) => {
  test.slow()
  await asInsecureContext(page)

  // Any uncaught error in a handler is the failure this guards against, so
  // treat one as a test failure rather than waiting for a visible symptom.
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))

  await page.goto('/sign-up')
  await page.getByLabel('Name').fill('Insecure Tester')
  await page.getByLabel('Email').fill(uniqueEmail())
  await page.getByLabel('Password').fill('insecure-password-1234')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/shoots$/, { timeout: 30_000 })

  await page.goto('/templates')
  await page.getByLabel('Template name').fill('Phone made')
  await page.getByLabel('Template shoot type').selectOption({ label: 'Portrait' })
  await page.getByRole('button', { name: 'Add template' }).click()
  await page.getByRole('link', { name: 'Phone made' }).click()
  await page.getByRole('button', { name: 'Add contents' }).click()

  // The exact step that failed on a handset.
  await page.getByLabel('New checklist name').fill('Camera bag')
  await page.getByRole('button', { name: 'Add list' }).click()
  await expect(page.getByLabel('Add items to checklist 1')).toBeVisible()

  await page.getByLabel('Add items to checklist 1').fill('Batteries\nCards')
  await page.getByRole('button', { name: 'Add', exact: true }).click()

  await page.getByRole('button', { name: 'Add a shot' }).click()
  await page.getByLabel('Shot 1 title').fill('Wide establishing frame')

  await page.getByRole('button', { name: 'Publish' }).click()
  await expect(page.getByText('· Version 1')).toBeVisible()

  // Publishing has to say so. Closing the editor on its own is
  // indistinguishable from the button having done nothing.
  await expect(page.getByText(/Published version 1, with 3 items/)).toBeVisible()

  expect(errors).toEqual([])
})

test('publish is disabled until there is something to publish', async ({ page }) => {
  await page.goto('/sign-up')
  await page.getByLabel('Name').fill('Empty Tester')
  await page.getByLabel('Email').fill(uniqueEmail())
  await page.getByLabel('Password').fill('empty-password-1234')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/shoots$/, { timeout: 30_000 })

  await page.goto('/templates')
  await page.getByLabel('Template name').fill('Still empty')
  await page.getByRole('button', { name: 'Add template' }).click()
  await page.getByRole('link', { name: 'Still empty' }).click()
  await page.getByRole('button', { name: 'Add contents' }).click()

  // Disabled, and saying why rather than just refusing.
  await expect(page.getByRole('button', { name: 'Publish' })).toBeDisabled()
  await expect(page.getByText('Add at least one shot or checklist item.')).toBeVisible()

  // A list with no items on it still does not count.
  await page.getByLabel('New checklist name').fill('Camera bag')
  await page.getByRole('button', { name: 'Add list' }).click()
  await expect(page.getByRole('button', { name: 'Publish' })).toBeDisabled()

  await page.getByLabel('Add items to checklist 1').fill('Batteries')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Publish' })).toBeEnabled()
  await expect(page.getByText('1 item will be published.')).toBeVisible()
})
