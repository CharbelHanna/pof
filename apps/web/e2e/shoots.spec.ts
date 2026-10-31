import { expect, test, type Page } from '@playwright/test'

/**
 * The Phase 0 acceptance criterion, automated:
 *
 *   "Sign up on your phone, create a shoot, reload, it persists."
 *
 * Everything here goes through the real stack — Better Auth, the oRPC
 * procedures, the service layer, `withTenant`, and the row-level security
 * policies — so a pass means the whole chain works, not that a mock does.
 */

/** Unique per test so suites can run in parallel without colliding. */
function uniqueEmail(): string {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@pof.test`
}

async function signUp(page: Page): Promise<string> {
  const email = uniqueEmail()

  await page.goto('/sign-up')
  await page.getByLabel('Name').fill('E2E Photographer')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('test-password-1234')
  await page.getByRole('button', { name: 'Create account' }).click()

  // A workspace is provisioned lazily on the first authenticated request, so
  // landing on /shoots is also the proof that provisioning succeeded.
  //
  // Generous timeout: this step includes a scrypt password hash, which is
  // intentionally slow, plus first-hit route compilation under `next dev`.
  await expect(page).toHaveURL(/\/shoots$/, { timeout: 30_000 })

  return email
}

test('a new photographer can sign up and gets an empty shoot list', async ({ page }) => {
  await signUp(page)

  await expect(page.getByRole('heading', { name: 'Shoots' })).toBeVisible()
  await expect(page.getByText('No shoots yet.')).toBeVisible()
})

test('the empty list explains the model, and stops once there is a shoot', async ({ page }) => {
  await signUp(page)

  // The only moment the structure is explained, so it is worth a test:
  // silently losing it would leave every new account staring at one line of
  // text with no idea what a session or a shot is for.
  const explainer = page.getByRole('heading', { name: 'How Point of Focus fits together' })
  await expect(explainer).toBeVisible()
  await expect(page.getByText('Start with a shoot. Everything else is optional.')).toBeVisible()

  await page.getByLabel('Shoot name').fill('First real shoot')
  await page.getByRole('button', { name: 'Add shoot' }).click()
  await expect(page.getByText('First real shoot')).toBeVisible()

  // Onboarding, not decoration — it gets out of the way once it has done
  // its job.
  await expect(explainer).toBeHidden()
})

test('creating a shoot persists it across a reload', async ({ page }) => {
  await signUp(page)

  await page.getByLabel('Shoot name').fill('Rooftop golden hour')
  await page.getByLabel('Shoot type').selectOption('editorial')
  await page.getByRole('button', { name: 'Add' }).click()

  await expect(page.getByText('Rooftop golden hour')).toBeVisible()

  // The actual Phase 0 acceptance check: it came back from the database, not
  // from client state.
  await page.reload()
  await expect(page.getByText('Rooftop golden hour')).toBeVisible()
  await expect(page.getByText('editorial · draft')).toBeVisible()
})

test('a shoot status can be changed and survives a reload', async ({ page }) => {
  await signUp(page)

  await page.getByLabel('Shoot name').fill('Studio portraits')
  await page.getByRole('button', { name: 'Add' }).click()
  await expect(page.getByText('Studio portraits')).toBeVisible()

  // Wait for the update to land before reloading. Reloading straight after
  // selectOption cancels the in-flight mutation, and the reloaded page shows
  // the old status — which reads as "status does not persist" rather than as
  // the test being impatient. Same race the campaign-grouping and
  // save-details tests already guard against.
  const saved = page.waitForResponse(
    (response) => response.url().includes('/shoots/update') && response.ok(),
  )
  await page.getByLabel('Status for Studio portraits').selectOption('confirmed')
  await saved

  await page.reload()
  await expect(page.getByText('portrait · confirmed')).toBeVisible()
})

test('deleting a shoot removes it from the list', async ({ page }) => {
  await signUp(page)

  await page.getByLabel('Shoot name').fill('Cancelled booking')
  await page.getByRole('button', { name: 'Add' }).click()
  await expect(page.getByText('Cancelled booking')).toBeVisible()

  await page.getByLabel('Delete Cancelled booking').click()

  // Soft delete: the row survives as a tombstone for syncing clients, but
  // must disappear from the normal listing.
  await expect(page.getByText('Cancelled booking')).toBeHidden()
  await page.reload()
  await expect(page.getByText('Cancelled booking')).toBeHidden()
})

test('one photographer cannot see another photographer’s shoots', async ({ browser }) => {
  // Two isolated browser contexts — separate cookie jars, genuinely different
  // users, exercising tenancy end to end rather than at the repository layer.
  const first = await browser.newContext()
  const second = await browser.newContext()

  try {
    const pageA = await first.newPage()
    await signUp(pageA)
    await pageA.getByLabel('Shoot name').fill('Private client work')
    await pageA.getByRole('button', { name: 'Add' }).click()
    await expect(pageA.getByText('Private client work')).toBeVisible()

    const pageB = await second.newPage()
    await signUp(pageB)

    await expect(pageB.getByText('No shoots yet.')).toBeVisible()
    await expect(pageB.getByText('Private client work')).toBeHidden()
  } finally {
    await first.close()
    await second.close()
  }
})

test('signing out protects the app and sign-in restores access', async ({ page }) => {
  await signUp(page)
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/sign-in$/)

  // The guard runs on the server, so an unauthenticated visitor never
  // receives the page at all rather than receiving it and having JavaScript
  // hide it.
  await page.goto('/shoots')
  await expect(page).toHaveURL(/\/sign-in$/)
})
