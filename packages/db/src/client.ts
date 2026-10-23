import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import * as schema from './schema/index.ts'

/**
 * Connection plumbing. Internal to @pof/db — application code never imports
 * this; it goes through `withTenant`.
 *
 * Plain `postgres://` over TCP with the standard `postgres` driver. No
 * provider-specific serverless/WebSocket driver, so the identical code runs
 * against a local `postgres:18-alpine` container, Neon, Supabase, RDS or Azure
 * Database for PostgreSQL by changing DATABASE_URL alone.
 */

export type Database = ReturnType<typeof createDatabase>['db']

export function createDatabase(connectionString: string, options?: { max?: number }) {
  const client = postgres(connectionString, {
    max: options?.max ?? 10,
    /**
     * Prepared statements are disabled because transaction-mode poolers
     * (PgBouncer, and most managed "pooled" endpoints) cannot route them
     * safely. Keeping this off is part of staying host-portable.
     */
    prepare: false,
    types: {
      /**
       * Return DATE/TIMESTAMP as-is and let Drizzle's `mode: 'date'` do the
       * conversion, so timestamp handling is defined in exactly one place.
       */
    },
  })

  return { client, db: drizzle(client, { schema }) }
}

let shared: { client: postgres.Sql; db: Database } | undefined

/**
 * Process-wide connection, created on first use.
 *
 * Deliberately NOT exported from the package root. The only things that may
 * reach for it are `withTenant` (which wraps it in a tenant transaction) and
 * the Better Auth adapter (which must read `user`/`session` before any
 * workspace context exists).
 */
export function sharedDatabase(connectionString: string): { client: postgres.Sql; db: Database } {
  shared ??= createDatabase(connectionString)
  return shared
}

/** Test-only: drop the shared connection between suites. */
export async function closeSharedDatabase(): Promise<void> {
  if (!shared) return
  await shared.client.end({ timeout: 5 })
  shared = undefined
}
