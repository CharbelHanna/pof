import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests against the real stack: real Next server, real Better Auth,
 * real Postgres, real row-level security.
 *
 * Runs `next dev` rather than a production build so the suite is fast to
 * iterate on locally; CI additionally builds the container images, which is
 * what proves the production path.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',

  /**
   * Deliberately few workers.
   *
   * Every test signs up a user, and Better Auth hashes passwords with scrypt,
   * which is *designed* to be CPU-expensive. Running a dozen sign-ups at once
   * against a single dev server saturates the machine and each request slows
   * to many seconds — tests then fail on timeout while the server is working
   * correctly. That is a false signal, not a bug worth surfacing.
   *
   * Throughput here is bounded by intentional cryptographic cost, so adding
   * workers makes the suite slower and flakier rather than faster.
   */
  workers: process.env.CI ? 2 : 3,

  /**
   * Playwright's 5s default is tuned for a warm, idle app. Here each test
   * performs a scrypt password hash (intentionally expensive) against a dev
   * server that compiles routes on first hit, with several workers competing
   * for the same CPU. Assertions were failing while the server was working
   * correctly — a false signal that would train everyone to re-run the suite.
   *
   * This buys patience, not correctness: a genuinely broken assertion still
   * fails, just 10s later.
   */
  expect: { timeout: 10_000 },

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },

  projects: [
    {
      /**
       * Mobile viewport from day one, not as an afterthought.
       *
       * V1 is phone-browser-first: photographers prepare on the move and use
       * the app on set. Testing only at desktop width would let the primary
       * experience regress unnoticed.
       */
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'desktop-chrome',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
