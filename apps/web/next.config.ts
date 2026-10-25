import { existsSync } from 'node:fs'
import { join } from 'node:path'

import type { NextConfig } from 'next'

/**
 * Load the monorepo-root .env for `next dev` and `next build`.
 *
 * Next only looks for .env beside the app, but configuration is shared with
 * the worker, the migration runner and the seed script, so a single root file
 * is the honest place for it.
 *
 * This covers dev and build only. The standalone server runs from a nested
 * output directory where this relative path no longer points anywhere, and in
 * a real deployment there is no file at all — the platform supplies real
 * environment variables. The `start` script therefore passes
 * `--env-file-if-exists` explicitly rather than relying on this.
 */
const rootEnv = join(import.meta.dirname, '..', '..', '.env')
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv)

const nextConfig: NextConfig = {
  /**
   * Produces a self-contained server bundle so the Dockerfile can ship a thin
   * runtime image. This is the whole portability story: one container that
   * runs on Railway, Fly, Hetzner, Azure Container Apps, ECS or a laptop.
   */
  output: 'standalone',

  /**
   * Workspace packages export TypeScript source rather than built JS, so Next
   * must compile them. This is also what keeps the packages consumable by
   * Metro later without a build step.
   */
  transpilePackages: [
    '@pof/api',
    '@pof/api-client',
    '@pof/auth',
    '@pof/config',
    '@pof/core',
    '@pof/db',
    '@pof/schemas',
  ],

  images: {
    /**
     * We generate our own AVIF/WebP derivatives in the worker (Phase 2) and
     * serve them from the storage CDN at known sizes. Running Next's optimiser
     * on top would duplicate that work, and self-hosted it is a per-instance
     * CPU and disk-cache liability that quietly prevents horizontal scaling.
     */
    unoptimized: true,
  },

  /**
   * Deliberately NOT enabling Cache Components or ISR.
   *
   * Next 16 defaults its data cache and ISR to per-instance memory plus local
   * disk. Across two or more containers that means `revalidateTag()`
   * invalidates exactly one of them, and getting it right off-platform needs
   * Redis, a shared cacheHandler, `cacheMaxMemorySize: 0`, a pinned
   * `generateBuildId` and a shared server-actions encryption key.
   *
   * This application is a logged-in, per-tenant planning tool: almost nothing
   * is cacheable across users, so the framework cache buys close to nothing.
   * Public marketing pages are statically generated at build time and need no
   * shared cache. Keeping it off is what lets N web containers run behind any
   * load balancer with zero extra infrastructure.
   */
  cacheComponents: false,

  // Fail the build on type errors rather than shipping them.
  typescript: { ignoreBuildErrors: false },
}

export default nextConfig
