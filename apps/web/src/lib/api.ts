'use client'

import { createApiClient, createApiQueryUtils } from '@pof/api-client'

/**
 * Browser API client.
 *
 * Relative URL so the same bundle works on localhost, a preview deployment
 * and production without a build-time origin baked in — one more thing that
 * keeps the deployment target an open question.
 */
export const api = createApiClient({ url: '/api/rpc' })

/** Typed TanStack Query options and keys for every procedure. */
export const orpc = createApiQueryUtils(api)
