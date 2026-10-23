/**
 * Root Vitest config is intentionally absent — each package owns its own, so
 * `pnpm --filter <pkg> test` behaves the same locally and under Turborepo.
 * This file exists only to stop editors guessing at a workspace-wide runner.
 */
export default ['packages/*/vitest.config.ts']
