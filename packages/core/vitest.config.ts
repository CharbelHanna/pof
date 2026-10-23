import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Reuses the exact harness @pof/db uses: one real Postgres, real
    // migrations, real RLS, and the same unprivileged role the app connects
    // as. Sharing it rather than copying keeps the role model from drifting
    // between packages — a drifted harness would test something production
    // never does.
    globalSetup: ['@pof/db/testing/global-setup'],
    hookTimeout: 180_000,
    testTimeout: 30_000,
  },
})
