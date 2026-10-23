import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globalSetup: ['./src/testing/global-setup.ts'],
    // Pulling the postgres:18-alpine image on a cold machine dominates the
    // first run; the container itself starts in a second or two after that.
    hookTimeout: 180_000,
    testTimeout: 30_000,
  },
})
