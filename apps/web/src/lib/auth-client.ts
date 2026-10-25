'use client'

import { organizationClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

/**
 * Browser-side auth client.
 *
 * No baseURL: same-origin requests go to /api/auth. The Expo client (Phase 8)
 * supplies an absolute URL plus `expoClient` with SecureStore, and otherwise
 * uses this identical surface.
 */
export const authClient = createAuthClient({
  plugins: [organizationClient()],
})

export const { signIn, signUp, signOut, useSession } = authClient
