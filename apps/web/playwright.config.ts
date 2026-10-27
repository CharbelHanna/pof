import { defineConfig, devices } from '@playwright/test'

/**
 * `process.env` with undefined entries dropped, which is the shape
 * `webServer.env` requires.
 */
function inheritedEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )
}

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
   *
   * Two, not three: at three, `next dev` was slow enough to hydrate that
   * clicks landed on server-rendered HTML. The form then submitted natively,
   * the page reloaded, and the controlled input reset — which surfaces as
   * "the campaign was never created" and looks like a broken form rather
   * than a race.
   */
  workers: 2,

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
    baseURL: 'http://localhost:3100',
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
    // Invokes next directly rather than `pnpm dev`, whose script pins
    // --port 3000.
    command: 'pnpm exec next dev --port 3100',
    // Deliberately not port 3000. `reuseExistingServer` attaches to whatever
    // already holds the port, and if the compose stack is up that is the
    // production container — so the suite silently exercises a different
    // build, with Better Auth's rate limiting enabled (it is off when
    // NODE_ENV is development), and sign-ups start returning 429.
    //
    // Running the tests on their own port means `docker compose up` and
    // `pnpm test:e2e` no longer fight over one address, and the suite always
    // gets the server it asked for.
    url: 'http://localhost:3100',
    /**
     * `webServer.env` REPLACES the environment rather than extending it, so
     * the inherited variables have to be passed through explicitly.
     *
     * Omitting the spread cost a CI run: DATABASE_URL, BETTER_AUTH_SECRET and
     * the storage credentials all arrived undefined and the server refused to
     * boot. It passed locally the whole time, because `next.config.ts` loads
     * the repo-root .env — which exists on a developer machine and does not
     * exist in CI.
     */
    env: { ...inheritedEnv(), PORT: '3100', APP_URL: 'http://localhost:3100' },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
