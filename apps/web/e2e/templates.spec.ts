import { expect, test, type Page } from '@playwright/test'

/**
 * Session templates, end to end.
 *
 * The loop worth proving is the whole point of the feature: build a session
 * once, save it, and get it back on a different shoot. Anything less — a
 * template that saves but cannot be applied, or applies but arrives empty —
 * looks fine in isolation and is useless in practice.
 */

function uniqueEmail(): string {
  return `template-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@pof.test`
}

async function signUp(page: Page): Promise<void> {
  await page.goto('/sign-up')
  await page.getByLabel('Name').fill('Template Tester')
  await page.getByLabel('Email').fill(uniqueEmail())
  await page.getByLabel('Password').fill('template-password-1234')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/shoots$/, { timeout: 30_000 })
}

async function createShoot(page: Page, name: string): Promise<void> {
  await page.goto('/shoots')
  await page.getByLabel('Shoot name').fill(name)
  await page.getByRole('button', { name: 'Add shoot' }).click()
  await page.getByText(name).click()
  await expect(page.getByRole('heading', { name: 'Shots', exact: true })).toBeVisible()
}

async function addSession(page: Page, name: string): Promise<void> {
  await page.getByLabel('Session timezone').fill('UTC')
  await page.getByLabel('Session name').fill(name)
  await page.getByLabel('Session start').fill('2027-06-21T09:00')
  await page.getByLabel('Session length in hours').selectOption('6')
  await page.getByRole('button', { name: 'Add session' }).click()
  await expect(page.getByLabel(`Save ${name} as a template`)).toBeVisible()
}

async function addShot(page: Page, title: string): Promise<void> {
  await page.getByLabel('Shot title').fill(title)
  await page.getByRole('button', { name: 'Add shot' }).click()
  await expect(page.getByLabel(`Title for ${title}`)).toBeVisible()
}

/**
 * These build a whole shoot, save it, and rebuild it somewhere else, so they
 * do several times the work of a normal test — two sign-ups' worth of scrypt
 * hashing, four page loads and a dozen mutations each. `test.slow()` triples
 * the budget for exactly this case rather than raising it globally for the
 * ninety tests that do not need it.
 */
test('a session can be saved as a template and applied to another shoot', async ({ page }) => {
  test.slow()
  await signUp(page)

  // --- build something worth repeating -----------------------------------
  await createShoot(page, 'Newborn session')
  await addSession(page, 'Day one')
  await addShot(page, 'Wide establishing frame')
  await addShot(page, 'Hands and feet detail')

  await page.getByLabel('New checklist name').fill('Camera bag')
  await page.getByLabel('Checklist kind').selectOption('gear')
  await page.getByRole('button', { name: 'Add list' }).click()
  await page.getByLabel('Add items to Camera bag').fill('Batteries\nCards')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByLabel('Camera bag progress')).toHaveText('0 of 2')

  // --- save it -----------------------------------------------------------
  await page.getByLabel('Save Day one as a template').click()
  await page.getByLabel('Name for the template from Day one').fill('Standard newborn')
  await page.getByRole('button', { name: 'Save', exact: true }).click()

  // Four items: two shots and two checklist lines.
  await expect(page.getByText(/Saved as .Standard newborn., with 4 items/)).toBeVisible()

  // --- it shows up with its contents -------------------------------------
  await page.goto('/templates')
  await expect(page.getByRole('link', { name: 'Standard newborn' })).toBeVisible()
  await page.getByRole('link', { name: 'Standard newborn' }).click()

  await expect(page.getByRole('heading', { name: 'Standard newborn' })).toBeVisible()
  await expect(page.getByText('Wide establishing frame')).toBeVisible()
  await expect(page.getByText('Hands and feet detail')).toBeVisible()
  // Grouped back into the list it will become, not shown as loose lines.
  await expect(page.getByRole('heading', { name: /Camera bag/ })).toBeVisible()
  await expect(page.getByText('Batteries')).toBeVisible()

  // --- apply it somewhere else -------------------------------------------
  await createShoot(page, 'Another newborn')
  await addSession(page, 'The morning')

  await page.getByLabel('Apply a template to The morning').selectOption({
    label: 'Standard newborn',
  })

  await expect(page.getByText('Added 2 shots and 2 checklist items.')).toBeVisible()

  // The real assertion: the work actually arrived on this shoot.
  await expect(page.getByLabel('Title for Wide establishing frame')).toBeVisible()
  await expect(page.getByLabel('Title for Hands and feet detail')).toBeVisible()
  await expect(page.getByLabel('Camera bag progress')).toHaveText('0 of 2')

  await page.reload()
  await expect(page.getByLabel('Title for Wide establishing frame')).toBeVisible()
  await expect(page.getByLabel('Camera bag progress')).toHaveText('0 of 2')
})

test('a template with nothing in it says so and cannot be applied', async ({ page }) => {
  await signUp(page)

  await page.goto('/templates')
  await page.getByLabel('Template name').fill('Empty one')
  await page.getByRole('button', { name: 'Add template' }).click()

  await expect(page.getByText('Nothing saved in it yet')).toBeVisible()

  await page.getByRole('link', { name: 'Empty one' }).click()
  await expect(
    page.getByText('has been named but has nothing in it', { exact: false }),
  ).toBeVisible()

  /**
   * An empty template must not be offered for applying. Silently doing
   * nothing is the worst available outcome — it looks like the feature is
   * broken rather than like the template is.
   */
  await createShoot(page, 'Somewhere to apply it')
  await addSession(page, 'Day one')
  await expect(page.getByLabel('Apply a template to Day one')).toHaveCount(0)
})

test('deleting a template leaves the shoots built from it alone', async ({ page }) => {
  test.slow()
  await signUp(page)

  await createShoot(page, 'Source shoot')
  await addSession(page, 'Day one')
  await addShot(page, 'Wide establishing frame')

  await page.getByLabel('Save Day one as a template').click()
  await page.getByLabel('Name for the template from Day one').fill('Throwaway')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText(/Saved as .Throwaway./)).toBeVisible()

  await createShoot(page, 'Target shoot')
  await addSession(page, 'The morning')
  await page.getByLabel('Apply a template to The morning').selectOption({ label: 'Throwaway' })
  await expect(page.getByText('Added 1 shot and 0 checklist items.')).toBeVisible()

  await page.goto('/templates')
  await page.getByRole('link', { name: 'Throwaway' }).click()
  await page.getByLabel('Delete template Throwaway').click()
  await expect(page).toHaveURL(/\/templates$/)
  await expect(page.getByRole('link', { name: 'Throwaway' })).toHaveCount(0)

  // The shoot keeps what it was given. Copying rather than linking is the
  // whole reason this holds.
  await page.goto('/shoots')
  await page.getByText('Target shoot').click()
  await expect(page.getByLabel('Title for Wide establishing frame')).toBeVisible()
})
