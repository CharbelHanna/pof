import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

/**
 * Uploading a reference, end to end.
 *
 * The bytes really do travel: the browser PUTs straight to the storage
 * container using a presigned URL the server generated, exactly as a user's
 * browser would. That makes this the only check that the signed URL names a
 * host a browser can actually reach — a mistake that is invisible to every
 * unit test, and which this suite caught during development when presigned
 * URLs pointed at the compose-internal hostname.
 */

const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'reference.png')

function uniqueEmail(): string {
  return `board-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@pof.test`
}

async function signUpAndOpenShoot(page: Page): Promise<void> {
  await page.goto('/sign-up')
  await page.getByLabel('Name').fill('Board Tester')
  await page.getByLabel('Email').fill(uniqueEmail())
  await page.getByLabel('Password').fill('board-password-1234')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/shoots$/, { timeout: 30_000 })

  await page.getByLabel('Shoot name').fill('Vogue Italia editorial')
  await page.getByRole('button', { name: 'Add shoot' }).click()
  await page.getByText('Vogue Italia editorial').click()
  await expect(page.getByRole('heading', { name: 'References', exact: true })).toBeVisible()
}

test('a reference can be uploaded and appears on the board', async ({ page }) => {
  await signUpAndOpenShoot(page)

  // The input is visually hidden behind a styled button, which is why this
  // targets it directly rather than clicking.
  await page.getByLabel('Add references').setInputFiles(fixture)

  /**
   * The tile appearing is the real assertion: it only renders once the
   * upload completed, the server confirmed the bytes were really in storage,
   * a board was created and the item was added. Generous timeout because a
   * genuine PUT is happening.
   */
  const tile = page.getByRole('button', { name: 'Open reference' })
  await expect(tile).toBeVisible({ timeout: 30_000 })

  // And it survives a reload, so it came from the database rather than from
  // client state.
  await page.reload()
  await expect(page.getByRole('button', { name: 'Open reference' })).toBeVisible({
    timeout: 30_000,
  })
})

test('a reference opens in the lightbox and can be removed', async ({ page }) => {
  await signUpAndOpenShoot(page)
  await page.getByLabel('Add references').setInputFiles(fixture)
  await expect(page.getByRole('button', { name: 'Open reference' })).toBeVisible({
    timeout: 30_000,
  })

  await page.getByRole('button', { name: 'Open reference' }).click()
  await expect(page.getByRole('dialog', { name: 'Reference' })).toBeVisible()

  await page.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByRole('dialog', { name: 'Reference' })).toBeHidden()

  await page.getByRole('button', { name: 'Remove reference' }).click()
  await expect(page.getByRole('button', { name: 'Open reference' })).toBeHidden({
    timeout: 15_000,
  })
})

test('an unsupported file is refused before anything is uploaded', async ({ page }) => {
  await signUpAndOpenShoot(page)

  await page
    .getByLabel('Add references')
    .setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('nope') })

  // Checked in the browser so the user is not made to wait through an
  // upload to be told the file was never acceptable.
  await expect(page.getByText(/not supported/i)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open reference' })).toBeHidden()
})
