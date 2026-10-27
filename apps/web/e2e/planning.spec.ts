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

/**
 * Navigate to /campaigns and wait until the page is actually interactive.
 *
 * The list renders "Loading…" server-side and only becomes "No campaigns yet"
 * once the client query resolves — which cannot happen before React has
 * hydrated. Waiting for that transition is therefore a reliable hydration
 * marker.
 *
 * Without it, a fast click submits the form natively: the browser reloads the
 * page, the controlled input resets, and nothing is created. The test then
 * fails with an empty field and no campaign, which looks like a broken form
 * rather than a race.
 */
async function gotoCampaigns(page: Page): Promise<void> {
  await page.goto('/campaigns')
  await expect(
    page
      .getByText('No campaigns yet.')
      // A link to a specific campaign. Scoped by href rather than by role
      // alone: the header's own "Point of Focus" and "Campaigns" links are
      // present in the server HTML, so matching any link would resolve
      // instantly and wait for nothing.
      .or(page.locator('a[href^="/campaigns/"]').first()),
  ).toBeVisible()
}

/**
 * Open a shoot from the list and wait until its detail page is really there.
 *
 * Asserting the URL matters: if the click lands before hydration, nothing
 * navigates and the following locators run against the LIST page — which now
 * has its own "Campaign for new shoot" and "Filter by campaign" controls, so
 * a loose `getByLabel('Campaign')` silently matches the wrong thing.
 */
async function openShoot(page: Page, name: string): Promise<void> {
  await page.getByRole('link', { name: new RegExp(name) }).click()
  await expect(page).toHaveURL(/\/shoots\/[0-9a-f-]+$/)
}

/**
 * Save genre details and wait for the write to land.
 *
 * Clicking and reloading straight away races the request: the navigation
 * cancels the in-flight mutation, nothing is persisted, and the reloaded page
 * shows empty fields — which reads like the save is broken rather than like
 * the test is impatient.
 */
async function saveDetails(page: Page): Promise<void> {
  const saved = page.waitForResponse(
    (response) => response.url().includes('/shoots/update') && response.ok(),
  )
  await page.getByRole('button', { name: 'Save details' }).click()
  await saved
}

async function createShoot(page: Page, name: string, type = 'portrait'): Promise<void> {
  await page.getByLabel('Shoot name').fill(name)
  await page.getByLabel('Shoot type').selectOption(type)
  await page.getByRole('button', { name: 'Add shoot' }).click()
  await expect(page.getByText(name)).toBeVisible()
}

test('genre fields change when the shoot type changes', async ({ page }) => {
  await signUp(page)
  await createShoot(page, 'Genre switcher', 'editorial')
  await openShoot(page, 'Genre switcher')

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
  await openShoot(page, 'Editorial details')

  await page.getByLabel('Publication').fill('Vogue Italia')
  await page.getByLabel('Number of looks').fill('4')
  await saveDetails(page)

  await page.reload()
  await expect(page.getByLabel('Publication')).toHaveValue('Vogue Italia')
  await expect(page.getByLabel('Number of looks')).toHaveValue('4')
})

test('a shoot can be grouped into a campaign, and survives its deletion', async ({ page }) => {
  await signUp(page)

  await gotoCampaigns(page)
  await page.getByLabel('Campaign name').fill('Autumn/Winter 27')
  await page.getByRole('button', { name: 'Add campaign' }).click()
  await expect(page.getByText('Autumn/Winter 27')).toBeVisible()

  await page.goto('/shoots')
  await createShoot(page, 'Grouped shoot')
  await openShoot(page, 'Grouped shoot')

  await page.getByLabel('Campaign', { exact: true }).selectOption({ label: 'Autumn/Winter 27' })
  await page.reload()
  await expect(page.getByLabel('Campaign', { exact: true })).toHaveValue(/.+/)

  // Deleting the campaign must not take the shoot with it — losing a shoot
  // means losing real planning work.
  await gotoCampaigns(page)
  await page.getByLabel('Delete Autumn/Winter 27').click()
  await expect(page.getByText('Autumn/Winter 27')).toBeHidden()

  await page.goto('/shoots')
  await expect(page.getByText('Grouped shoot')).toBeVisible()
})

test('a multi-session shoot shows its sessions in the shoot and the agenda', async ({ page }) => {
  await signUp(page)
  await createShoot(page, 'Multi-session shoot', 'editorial')
  await openShoot(page, 'Multi-session shoot')

  await page.getByLabel('Session timezone').fill('Europe/London')
  await page.getByLabel('Session name').fill('Studio day')
  await page.getByLabel('Session start').fill('2027-06-21T09:00')
  await page.getByLabel('Session length in hours').selectOption('6')
  await page.getByRole('button', { name: 'Add session' }).click()
  await expect(page.getByText('Studio day')).toBeVisible()

  await page.getByLabel('Session name').fill('Rooftop golden hour')
  await page.getByLabel('Session start').fill('2027-06-21T20:30')
  await page.getByRole('button', { name: 'Add session' }).click()
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
  await openShoot(page, 'Time check')

  await page.getByLabel('Session timezone').fill('UTC')
  await page.getByLabel('Session name').fill('Four hour block')
  await page.getByLabel('Session start').fill('2027-06-21T09:00')
  await page.getByLabel('Session length in hours').selectOption('4')
  await page.getByRole('button', { name: 'Add session' }).click()

  await expect(page.getByText('Four hour block')).toBeVisible()
  await expect(page.getByText(/09:00–13:00/)).toBeVisible()

  // The form cannot express an inverted session at all — the duration
  // selector only offers positive lengths — so that path is covered where it
  // can actually occur: the service (partial updates) and the database CHECK.
})

test('a shoot can be assigned to a campaign at creation', async ({ page }) => {
  await signUp(page)

  await gotoCampaigns(page)
  await page.getByLabel('Campaign name').fill('Spring 27')
  await page.getByRole('button', { name: 'Add campaign' }).click()
  await expect(page.getByText('Spring 27')).toBeVisible()

  await page.goto('/shoots')
  await page.getByLabel('Shoot name').fill('Born grouped')
  await page.getByLabel('Campaign for new shoot').selectOption({ label: 'Spring 27' })
  await page.getByRole('button', { name: 'Add shoot' }).click()

  // The grouping must be visible from the list itself — otherwise it is only
  // discoverable by opening each shoot in turn, which makes it useless.
  await expect(page.getByText(/portrait · draft · Spring 27/)).toBeVisible()
})

test('the shoot list can be filtered by campaign', async ({ page }) => {
  await signUp(page)

  await gotoCampaigns(page)
  await page.getByLabel('Campaign name').fill('Filtered')
  await page.getByRole('button', { name: 'Add campaign' }).click()
  await expect(page.getByText('Filtered')).toBeVisible()

  await page.goto('/shoots')
  await page.getByLabel('Shoot name').fill('Grouped shoot')
  await page.getByLabel('Campaign for new shoot').selectOption({ label: 'Filtered' })
  await page.getByRole('button', { name: 'Add shoot' }).click()
  await expect(page.getByText('Grouped shoot')).toBeVisible()

  await page.getByLabel('Shoot name').fill('Loose shoot')
  await page.getByLabel('Campaign for new shoot').selectOption('')
  await page.getByRole('button', { name: 'Add shoot' }).click()
  await expect(page.getByText('Loose shoot')).toBeVisible()

  await page.getByLabel('Filter by campaign').selectOption({ label: 'Filtered' })
  await expect(page.getByText('Grouped shoot')).toBeVisible()
  await expect(page.getByText('Loose shoot')).toBeHidden()

  await page.getByLabel('Filter by campaign').selectOption('none')
  await expect(page.getByText('Loose shoot')).toBeVisible()
  await expect(page.getByText('Grouped shoot')).toBeHidden()
})

test('a campaign can be opened and shows its shoots', async ({ page }) => {
  await signUp(page)

  await gotoCampaigns(page)
  await page.getByLabel('Campaign name').fill('Openable')
  await page.getByRole('button', { name: 'Add campaign' }).click()
  await expect(page.getByText('Openable')).toBeVisible()

  await page.getByRole('link', { name: /Openable/ }).click()
  await expect(page).toHaveURL(/\/campaigns\/[0-9a-f-]+$/)
  await expect(page.getByRole('heading', { name: 'Openable' })).toBeVisible()

  // A shoot created from inside a campaign is filed under it automatically.
  await page.getByLabel('Shoot name').fill('Made from inside')
  await page.getByRole('button', { name: 'Add shoot' }).click()
  await expect(page.getByText('Made from inside')).toBeVisible()

  await page.goto('/shoots')
  await expect(page.getByText(/Made from inside/)).toBeVisible()
  await expect(page.getByText(/portrait · draft · Openable/)).toBeVisible()
})

test('a session can be scheduled from the agenda', async ({ page }) => {
  await signUp(page)

  // With no shoots, the action explains the constraint rather than failing.
  await page.goto('/agenda')
  await expect(page.getByText(/Create a shoot first/)).toBeVisible()

  await page.goto('/shoots')
  await createShoot(page, 'Agenda target')

  await page.goto('/agenda')
  await page.getByRole('button', { name: 'Schedule a session' }).click()
  await page.getByLabel('Shoot for new session').selectOption({ label: 'Agenda target' })
  await page.getByLabel('New session name').fill('Planned from agenda')
  await page.getByLabel('New session timezone').fill('UTC')
  await page.getByLabel('New session start').fill('2027-05-10T08:00')
  await page.getByRole('button', { name: 'Add session' }).click()

  await expect(page.getByText('Planned from agenda')).toBeVisible()
  await expect(page.getByText(/08:00–10:00/)).toBeVisible()
})

test('boudoir is selectable and brings its own fields', async ({ page }) => {
  await signUp(page)
  await createShoot(page, 'Boudoir session', 'boudoir')
  await openShoot(page, 'Boudoir session')

  // Added as a row in shoot_type plus a registry definition — no component
  // here knows the genre exists.
  await expect(page.getByLabel('Location type')).toBeVisible()
  await expect(page.getByLabel('Chaperone or support person attending')).toBeVisible()

  await page.getByLabel('Location type').selectOption('hotel')
  await page.getByLabel('Hair and makeup artist').fill('Jo')
  await saveDetails(page)

  await page.reload()
  await expect(page.getByLabel('Location type')).toHaveValue('hotel')
  await expect(page.getByLabel('Hair and makeup artist')).toHaveValue('Jo')
})

test('crew can be added to a shoot', async ({ page }) => {
  await signUp(page)
  await createShoot(page, 'Crewed shoot')
  await openShoot(page, 'Crewed shoot')

  await page.getByLabel('Crew role').fill('Assistant')
  await page.getByLabel('Crew name').fill('Sam')
  await page.getByRole('button', { name: 'Add crew' }).click()

  await expect(page.getByText('Sam')).toBeVisible()
  await expect(page.getByText('1 person')).toBeVisible()

  // A role nobody anticipated must still work — crew roles are free text.
  await page.getByLabel('Crew role').fill('Dog handler')
  await page.getByRole('button', { name: 'Add crew' }).click()
  await expect(page.getByText('Dog handler')).toBeVisible()
  await expect(page.getByText('2 people')).toBeVisible()

  await page.reload()
  await expect(page.getByText('Sam')).toBeVisible()
})

test('gear is added to the library and packed off', async ({ page }) => {
  await signUp(page)
  await createShoot(page, 'Geared shoot')
  await openShoot(page, 'Geared shoot')

  // New kit joins the library and this shoot in one step.
  await page.getByLabel('New gear name').fill('85mm f/1.4')
  await page.getByLabel('New gear category').fill('Lens')
  await page.getByRole('button', { name: 'Add new' }).click()

  await expect(page.getByText('85mm f/1.4')).toBeVisible()
  await expect(page.getByText('0 of 1 packed')).toBeVisible()

  await page.getByLabel('Packed: 85mm f/1.4').click()
  await expect(page.getByText('1 of 1 packed')).toBeVisible()

  await page.reload()
  await expect(page.getByLabel('Packed: 85mm f/1.4')).toBeChecked()
})

test('library kit is reusable across shoots', async ({ page }) => {
  await signUp(page)

  await createShoot(page, 'First shoot')
  await openShoot(page, 'First shoot')
  await page.getByLabel('New gear name').fill('Tripod')
  await page.getByRole('button', { name: 'Add new' }).click()
  await expect(page.getByText('Tripod')).toBeVisible()

  await page.goto('/shoots')
  await createShoot(page, 'Second shoot')
  await openShoot(page, 'Second shoot')

  // The whole point of a library rather than free text: "my tripod" is one
  // thing, selectable again without retyping.
  await page.getByLabel('Gear from library').selectOption({ index: 1 })
  await page.getByRole('button', { name: 'Add gear' }).click()
  await expect(page.getByText('Tripod')).toBeVisible()
})
