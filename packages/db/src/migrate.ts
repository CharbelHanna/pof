import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

/**
 * Migration runner, invoked from the container entrypoint (and `pnpm
 * db:migrate` locally). Deliberately an explicit script rather than a platform
 * migration hook, so the same command works on compose, Railway, Fly, ECS or a
 * bare VM.
 *
 * Runs as DATABASE_MIGRATION_URL — the schema OWNER — which is a different
 * role from the one the application connects as. The owner role is the only
 * one permitted to run DDL.
 */

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

async function main(): Promise<void> {
  const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL

  if (!url) {
    throw new Error('DATABASE_MIGRATION_URL (or DATABASE_URL) must be set to run migrations')
  }

  // max: 1 — the migrator takes an advisory lock and must stay on one
  // connection. Several app instances booting at once is normal; they
  // serialise here rather than racing to apply the same DDL.
  const client = postgres(url, { max: 1, prepare: false, onnotice: () => {} })

  try {
    console.log(`[migrate] applying migrations from ${migrationsFolder}`)
    await migrate(drizzle(client), { migrationsFolder })
    console.log('[migrate] up to date')
  } finally {
    await client.end({ timeout: 5 })
  }
}

main().catch((error: unknown) => {
  console.error('[migrate] failed:', error)
  process.exit(1)
})
