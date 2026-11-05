import { expect, test, type Page } from '@playwright/test'

/**
 * The shot list, end to end.
 *
 * The running order is the part worth testing through a browser. It is held
 * in local state while being dragged and only committed as a whole list, so
 * the failure that matters is not a visual one — it is an order that looks
 * right until the page is reloaded and the server's real positions come back.
 * Every ordering assertion here is therefore made after a reload.
 */

function uniqueEmail(): string {
  return `shots-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@pof.test`
}

async function signUpAndOpenShoot(page: Page): Promise<void> {
  await page.goto('/sign-up')
  await page.getByLabel('Name').fill('Shot Tester')
  await page.getByLabel('Email').fill(uniqueEmail())
  await page.getByLabel('Password').fill('shot-password-1234')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/shoots$/, { timeout: 30_000 })

  await page.getByLabel('Shoot name').fill('Harbour at first light')
  await page.getByRole('button', { name: 'Add shoot' }).click()
  await page.getByText('Harbour at first light').click()
  await expect(page.getByRole('heading', { name: 'Shots', exact: true })).toBeVisible()
}

async function addShot(page: Page, title: string): Promise<void> {
  await page.getByLabel('Shot title').fill(title)
  await page.getByRole('button', { name: 'Add shot' }).click()
  await expect(page.getByLabel(`Title for ${title}`)).toBeVisible()
}

/** The titles currently rendered, in the order they appear. */
async function titles(page: Page): Promise<string[]> {
  return page
    .locator('[data-shot-id] input[aria-label^="Title for"]')
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLInputElement).value))
}

test('shots can be added, and keep the order they were added in', async ({ page }) => {
  await signUpAndOpenShoot(page)

  await expect(page.getByText('No shots yet.', { exact: false })).toBeVisible()

  await addShot(page, 'Wide establishing frame')
  await addShot(page, 'Boats at the quay')
  await addShot(page, 'Detail of the ropes')

  expect(await titles(page)).toEqual([
    'Wide establishing frame',
    'Boats at the quay',
    'Detail of the ropes',
  ])

  await expect(page.getByLabel('Shots captured')).toHaveText('0 of 3 captured')
})

test('marking a shot captured is recorded', async ({ page }) => {
  await signUpAndOpenShoot(page)
  await addShot(page, 'Wide establishing frame')
  await addShot(page, 'Boats at the quay')

  await page.getByLabel('Status for Wide establishing frame').selectOption('captured')
  await expect(page.getByLabel('Shots captured')).toHaveText('1 of 2 captured')

  await page.reload()
  await expect(page.getByLabel('Status for Wide establishing frame')).toHaveValue('captured')
  await expect(page.getByLabel('Status for Boats at the quay')).toHaveValue('planned')
})

/**
 * The keyboard path, which is also the one that proves the reorder endpoint
 * is wired up correctly — dragging and the arrow keys commit through exactly
 * the same call.
 */
test('the running order can be rearranged and survives a reload', async ({ page }) => {
  await signUpAndOpenShoot(page)

  await addShot(page, 'Wide establishing frame')
  await addShot(page, 'Boats at the quay')
  await addShot(page, 'Detail of the ropes')

  // Move the third shot up one place.
  await page.getByLabel('Reorder shot 3 of 3').focus()
  await page.getByLabel('Reorder shot 3 of 3').press('ArrowUp')

  await expect
    .poll(() => titles(page))
    .toEqual(['Wide establishing frame', 'Detail of the ropes', 'Boats at the quay'])

  /**
   * The assertion that counts. Up to here the order could be local state
   * alone; only a reload proves the positions were written.
   */
  await page.reload()
  await expect(page.getByLabel('Title for Wide establishing frame')).toBeVisible()

  expect(await titles(page)).toEqual([
    'Wide establishing frame',
    'Detail of the ropes',
    'Boats at the quay',
  ])
})

test('a shot carries its details, and can be deleted', async ({ page }) => {
  await signUpAndOpenShoot(page)
  await addShot(page, 'Boats at the quay')

  await page.getByLabel('Details for Boats at the quay').click()

  await page.getByLabel('Framing for Boats at the quay').fill('Wide')
  await page.getByLabel('Subjects for Boats at the quay').fill('Fishing boats')
  await page.getByLabel('Description for Boats at the quay').fill('Shoot into the low sun.')
  // Blur commits, so move focus off the last field before reloading.
  await page.getByLabel('Props for Boats at the quay').click()

  await page.reload()
  await page.getByLabel('Details for Boats at the quay').click()

  await expect(page.getByLabel('Framing for Boats at the quay')).toHaveValue('Wide')
  await expect(page.getByLabel('Subjects for Boats at the quay')).toHaveValue('Fishing boats')
  await expect(page.getByLabel('Description for Boats at the quay')).toHaveValue(
    'Shoot into the low sun.',
  )

  await page.getByLabel('Delete Boats at the quay').click()
  await expect(page.getByText('No shots yet.', { exact: false })).toBeVisible()
})
