import { expect, test, type Page } from '@playwright/test'

/**
 * Phase 1: campaigns, genre-specific fields, and sessions.
 *
 * The acceptance criterion from the plan is "plan a multi-session editorial
 * shoot; switch shoot type and confirm genre fields change" — which is what
 * the first two tests here do.
 */

function uniqueEmail(): string {
  return `e2e-p1-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@pof.test`
}

async function signUp(page: Page): Promise<void> {
  await page.goto('/sign-up')
  await page.getByLabel('Name').fill('E2E Planner')
  await page.getByLabel('Email').fill(uniqueEmail())
  await page.getByLabel('Password').fill('test-password-1234')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/shoots$/, { timeout: 30_000 })
}

async function createShoot(page: Page, name: string, type = 'portrait'): Promise<void> {
  await page.getByLabel('Shoot name').fill(name)
  await page.getByLabel('Shoot type').selectOption(type)
  await page.getByRole('button', { name: 'Add' }).click()
  await expect(page.getByText(name)).toBeVisible()
}

test('genre fields change when the shoot type changes', async ({ page }) => {
  await signUp(page)
  await createShoot(page, 'Genre switcher', 'editorial')
  await page.getByRole('link', { name: /Genre switcher/ }).click()

  // Editorial asks about the publication.
  await expect(page.getByLabel('Publication')).toBeVisible()
  await expect(page.getByLabel('Number of SKUs')).toBeHidden()

  await page.getByLabel('Shoot type').selectOption('product')

  // Product asks about SKUs instead — the whole point of the registry: no
  // component knows either genre exists.
  await expect(page.getByLabel('Number of SKUs')).toBeVisible()
  await expect(page.getByLabel('Publication')).toBeHidden()
})

test('genre details are saved and survive a reload', async ({ page }) => {
  await signUp(page)
  await createShoot(page, 'Editorial details', 'editorial')
  await page.getByRole('link', { name: /Editorial details/ }).click()

  await page.getByLabel('Publication').fill('Vogue Italia')
  await page.getByLabel('Number of looks').fill('4')
  await page.getByRole('button', { name: 'Save details' }).click()

  await page.reload()
  await expect(page.getByLabel('Publication')).toHaveValue('Vogue Italia')
  await expect(page.getByLabel('Number of looks')).toHaveValue('4')
})

test('a shoot can be grouped into a campaign, and survives its deletion', async ({ page }) => {
  await signUp(page)

  await page.goto('/campaigns')
  await page.getByLabel('Campaign name').fill('Autumn/Winter 27')
  await page.getByRole('button', { name: 'Add' }).click()
  await expect(page.getByText('Autumn/Winter 27')).toBeVisible()

  await page.goto('/shoots')
  await createShoot(page, 'Grouped shoot')
  await page.getByRole('link', { name: /Grouped shoot/ }).click()

  await page.getByLabel('Campaign').selectOption({ label: 'Autumn/Winter 27' })
  await page.reload()
  await expect(page.getByLabel('Campaign')).toHaveValue(/.+/)

  // Deleting the campaign must not take the shoot with it — losing a shoot
  // means losing real planning work.
  await page.goto('/campaigns')
  await page.getByLabel('Delete Autumn/Winter 27').click()
  await expect(page.getByText('Autumn/Winter 27')).toBeHidden()

  await page.goto('/shoots')
  await expect(page.getByText('Grouped shoot')).toBeVisible()
})

test('a multi-session shoot shows its sessions in the shoot and the agenda', async ({ page }) => {
  await signUp(page)
  await createShoot(page, 'Multi-session shoot', 'editorial')
  await page.getByRole('link', { name: /Multi-session shoot/ }).click()

  await page.getByLabel('Session timezone').fill('Europe/London')
  await page.getByLabel('Session name').fill('Studio day')
  await page.getByLabel('Session start').fill('2027-06-21T09:00')
  await page.getByLabel('Session length in hours').selectOption('6')
  await page.getByRole('button', { name: 'Add' }).click()
  await expect(page.getByText('Studio day')).toBeVisible()

  await page.getByLabel('Session name').fill('Rooftop golden hour')
  await page.getByLabel('Session start').fill('2027-06-21T20:30')
  await page.getByRole('button', { name: 'Add' }).click()
  await expect(page.getByText('Rooftop golden hour')).toBeVisible()

  // Rendered in the session's zone, not the browser's — the whole reason the
  // zone is stored alongside the instant.
  await expect(page.getByText(/09:00/)).toBeVisible()

  await page.goto('/agenda')
  await expect(page.getByText('Studio day')).toBeVisible()
  await expect(page.getByText('Rooftop golden hour')).toBeVisible()
})

test('a session spans the duration that was chosen', async ({ page }) => {
  await signUp(page)
  await createShoot(page, 'Time check')
  await page.getByRole('link', { name: /Time check/ }).click()

  await page.getByLabel('Session timezone').fill('UTC')
  await page.getByLabel('Session name').fill('Four hour block')
  await page.getByLabel('Session start').fill('2027-06-21T09:00')
  await page.getByLabel('Session length in hours').selectOption('4')
  await page.getByRole('button', { name: 'Add' }).click()

  await expect(page.getByText('Four hour block')).toBeVisible()
  await expect(page.getByText(/09:00–13:00/)).toBeVisible()

  // The form cannot express an inverted session at all — the duration
  // selector only offers positive lengths — so that path is covered where it
  // can actually occur: the service (partial updates) and the database CHECK.
})
