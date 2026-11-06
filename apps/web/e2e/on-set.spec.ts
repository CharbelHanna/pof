import { expect, test, type Page } from '@playwright/test'

/**
 * On-set mode, end to end.
 *
 * The thing worth proving here is that this surface is a view of the same
 * data rather than a second copy of it: a shot marked captured on set has to
 * be captured on the planning page, and a checklist item ticked here has to
 * be ticked there. A parallel store that drifts would be worse than no on-set
 * mode at all, because the drift is only discovered after the shoot.
 */

function uniqueEmail(): string {
  return `onset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@pof.test`
}

async function signUpAndOpenShoot(page: Page): Promise<void> {
  await page.goto('/sign-up')
  await page.getByLabel('Name').fill('On Set Tester')
  await page.getByLabel('Email').fill(uniqueEmail())
  await page.getByLabel('Password').fill('on-set-password-1234')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/shoots$/, { timeout: 30_000 })

  await page.getByLabel('Shoot name').fill('Cliff path at dawn')
  await page.getByRole('button', { name: 'Add shoot' }).click()
  await page.getByText('Cliff path at dawn').click()
  await expect(page.getByRole('heading', { name: 'Shots', exact: true })).toBeVisible()
}

async function addShot(page: Page, title: string): Promise<void> {
  await page.getByLabel('Shot title').fill(title)
  await page.getByRole('button', { name: 'Add shot' }).click()
  await expect(page.getByLabel(`Title for ${title}`)).toBeVisible()
}

test('shots can be worked through, and the result shows on the planning page', async ({ page }) => {
  await signUpAndOpenShoot(page)
  await addShot(page, 'Wide establishing frame')
  await addShot(page, 'Boats at the quay')

  await page.getByRole('link', { name: 'On set' }).click()
  await expect(page).toHaveURL(/\/on-set$/)

  await expect(page.getByRole('heading', { name: 'Cliff path at dawn' })).toBeVisible()
  await expect(page.getByLabel('Shots captured')).toContainText('0 of 2 captured')

  await page.getByLabel('Captured: Wide establishing frame').click()
  await expect(page.getByLabel('Shots captured')).toContainText('1 of 2 captured')

  /**
   * A captured shot leaves the working list. What is in front of you on set
   * should be what is still to get, not a list you have to re-read to find
   * your place in.
   */
  await expect(page.getByLabel('Captured: Wide establishing frame')).toHaveCount(0)
  await expect(page.getByText('Boats at the quay')).toBeVisible()

  await page.getByRole('button', { name: 'Show 1 finished' }).click()
  await expect(page.getByLabel('Undo: Wide establishing frame')).toBeVisible()

  // The real assertion: one store, not two.
  await page.getByRole('link', { name: '← Back to planning' }).click()
  await expect(page.getByLabel('Status for Wide establishing frame')).toHaveValue('captured')
  await expect(page.getByLabel('Status for Boats at the quay')).toHaveValue('planned')
})

test('skipping is recorded as a decision, not a deletion', async ({ page }) => {
  await signUpAndOpenShoot(page)
  await addShot(page, 'Rooftop silhouette')

  await page.getByRole('link', { name: 'On set' }).click()
  await page.getByLabel('Skip: Rooftop silhouette').click()

  await expect(page.getByText('Every shot accounted for.', { exact: false })).toBeVisible()
  // Captured and skipped are different outcomes; the count must not conflate them.
  await expect(page.getByLabel('Shots captured')).toContainText('0 of 1 captured')

  await page.getByRole('link', { name: '← Back to planning' }).click()
  await expect(page.getByLabel('Status for Rooftop silhouette')).toHaveValue('skipped')
})

test('a shot can be undone when it turns out not to be in the can', async ({ page }) => {
  await signUpAndOpenShoot(page)
  await addShot(page, 'Wide establishing frame')

  await page.getByRole('link', { name: 'On set' }).click()
  await page.getByLabel('Captured: Wide establishing frame').click()
  await expect(page.getByText('Every shot accounted for.', { exact: false })).toBeVisible()

  await page.getByRole('button', { name: 'Show 1 finished' }).click()
  await page.getByLabel('Undo: Wide establishing frame').click()

  await expect(page.getByLabel('Captured: Wide establishing frame')).toBeVisible()
  await expect(page.getByLabel('Shots captured')).toContainText('0 of 1 captured')
})

test('outstanding checklist items appear on set and tick off in one tap', async ({ page }) => {
  await signUpAndOpenShoot(page)

  await page.getByLabel('New checklist name').fill('Camera bag')
  await page.getByLabel('Checklist kind').selectOption('gear')
  await page.getByRole('button', { name: 'Add list' }).click()
  await expect(page.getByRole('heading', { name: /Camera bag/ })).toBeVisible()

  await page.getByLabel('Add items to Camera bag').fill('Batteries\nCards')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByLabel('Camera bag progress')).toHaveText('0 of 2')

  await page.getByRole('link', { name: 'On set' }).click()

  await expect(page.getByRole('heading', { name: 'Still to do' })).toBeVisible()
  await page.getByLabel('Done: Batteries').click()

  // Ticked items drop off the on-set list; only what is left is shown.
  await expect(page.getByLabel('Done: Batteries')).toHaveCount(0)
  await expect(page.getByLabel('Done: Cards')).toBeVisible()

  await page.getByRole('link', { name: '← Back to planning' }).click()
  await expect(page.getByLabel('Camera bag progress')).toHaveText('1 of 2')
})

test('a finished list disappears from on set entirely', async ({ page }) => {
  await signUpAndOpenShoot(page)

  await page.getByLabel('New checklist name').fill('Travel')
  await page.getByLabel('Checklist kind').selectOption('travel')
  await page.getByRole('button', { name: 'Add list' }).click()
  await expect(page.getByRole('heading', { name: /Travel/ })).toBeVisible()

  await page.getByLabel('Add items to Travel').fill('Parking permit')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByLabel('Done: Parking permit').check()
  await expect(page.getByLabel('Travel progress')).toHaveText('1 of 1')

  await page.getByRole('link', { name: 'On set' }).click()

  // Nothing outstanding, so the section is not there at all — an empty
  // "Still to do" heading is noise at exactly the wrong moment.
  await expect(page.getByRole('heading', { name: 'Still to do' })).toHaveCount(0)
})
