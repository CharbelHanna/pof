import { expect, test, type Page } from '@playwright/test'

/**
 * Checklists, end to end.
 *
 * The part worth testing through a browser rather than a unit test is the
 * progress counter: it is computed by a correlated subquery in the list
 * query, and an earlier version of that subquery silently counted zero
 * because the column references bound to the wrong table. Nothing errored —
 * an empty list and a broken query looked identical. Asserting the real
 * numbers here is what makes that class of failure visible.
 */

function uniqueEmail(): string {
  return `checklist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@pof.test`
}

async function signUpAndOpenShoot(page: Page): Promise<void> {
  await page.goto('/sign-up')
  await page.getByLabel('Name').fill('Checklist Tester')
  await page.getByLabel('Email').fill(uniqueEmail())
  await page.getByLabel('Password').fill('checklist-password-1234')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/shoots$/, { timeout: 30_000 })

  await page.getByLabel('Shoot name').fill('Dawn seascape')
  await page.getByRole('button', { name: 'Add shoot' }).click()
  await page.getByText('Dawn seascape').click()
  await expect(page.getByRole('heading', { name: 'Checklists', exact: true })).toBeVisible()
}

test('a list can be created, filled in one burst, and ticked off', async ({ page }) => {
  await signUpAndOpenShoot(page)

  await expect(page.getByText('No checklists yet.')).toBeVisible()

  await page.getByLabel('New checklist name').fill('Camera bag')
  await page.getByLabel('Checklist kind').selectOption('gear')
  await page.getByRole('button', { name: 'Add list' }).click()

  await expect(page.getByRole('heading', { name: /Camera bag/ })).toBeVisible()
  await expect(page.getByLabel('Camera bag progress')).toHaveText('0 of 0')

  /**
   * Three lines in one submit. This is the behaviour the bulk route exists
   * for — a packing list is written from memory in one sitting, and one
   * request per line is enough friction to send someone to a notes app.
   */
  await page.getByLabel('Add items to Camera bag').fill('Batteries\nCards\nTripod')
  await page.getByRole('button', { name: 'Add', exact: true }).click()

  await expect(page.getByText('Batteries')).toBeVisible()
  await expect(page.getByText('Cards')).toBeVisible()
  await expect(page.getByText('Tripod')).toBeVisible()

  // The counter is the real assertion: it proves the subquery correlates.
  await expect(page.getByLabel('Camera bag progress')).toHaveText('0 of 3')

  await page.getByLabel('Done: Batteries').check()
  await expect(page.getByLabel('Camera bag progress')).toHaveText('1 of 3')

  await page.getByLabel('Done: Cards').check()
  await expect(page.getByLabel('Camera bag progress')).toHaveText('2 of 3')

  // Unticking has to walk it back, not just stop incrementing.
  await page.getByLabel('Done: Batteries').uncheck()
  await expect(page.getByLabel('Camera bag progress')).toHaveText('1 of 3')
})

test('progress survives a reload, so it is stored rather than remembered', async ({ page }) => {
  await signUpAndOpenShoot(page)

  await page.getByLabel('New checklist name').fill('Before the day')
  await page.getByLabel('Checklist kind').selectOption('prep')
  await page.getByRole('button', { name: 'Add list' }).click()
  await expect(page.getByRole('heading', { name: /Before the day/ })).toBeVisible()

  await page.getByLabel('Add items to Before the day').fill('Charge batteries\nFormat cards')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByLabel('Before the day progress')).toHaveText('0 of 2')

  await page.getByLabel('Done: Charge batteries').check()
  await expect(page.getByLabel('Before the day progress')).toHaveText('1 of 2')

  await page.reload()

  await expect(page.getByLabel('Before the day progress')).toHaveText('1 of 2')
  await expect(page.getByLabel('Done: Charge batteries')).toBeChecked()
  await expect(page.getByLabel('Done: Format cards')).not.toBeChecked()
})

test('deleting a list takes its items with it', async ({ page }) => {
  await signUpAndOpenShoot(page)

  await page.getByLabel('New checklist name').fill('Travel')
  await page.getByLabel('Checklist kind').selectOption('travel')
  await page.getByRole('button', { name: 'Add list' }).click()
  await expect(page.getByRole('heading', { name: /Travel/ })).toBeVisible()

  await page.getByLabel('Add items to Travel').fill('Parking permit')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByText('Parking permit')).toBeVisible()

  await page.getByLabel('Delete checklist Travel').click()

  await expect(page.getByText('No checklists yet.')).toBeVisible()
  await expect(page.getByText('Parking permit')).toHaveCount(0)
})
