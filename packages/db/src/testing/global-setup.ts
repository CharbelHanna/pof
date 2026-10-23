import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { TestProject } from 'vitest/node'

/**
 * Spins up one real Postgres for the whole run — real migrations, real RLS.
 *
 * Testcontainers rather than a provider's database-branching feature: it needs
 * no vendor account, works identically on a laptop and in CI, and keeps the
 * test story as portable as the deployment story.
 *
 * One container is started here and its URLs handed to suites via `provide()`.
 * Suites must NOT drop or recreate tables in `beforeAll` — Vitest runs files in
 * parallel workers against this shared database, so a suite that truncates
 * globally corrupts its neighbours. Each suite isolates itself by using its own
 * workspace ids instead (which is also a more honest test of tenant scoping).
 */

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations')

const OWNER_PASSWORD = 'owner_password'
const APP_PASSWORD = 'app_password'

let container: StartedPostgreSqlContainer | undefined

export default async function setup({ provide }: TestProject) {
  container = await new PostgreSqlContainer('postgres:18-alpine')
    .withDatabase('pof')
    .withUsername('postgres')
    .withPassword('postgres')
    // Deliberately NOT .withReuse(): the teardown below stops the container,
    // which would defeat reuse anyway, and a reused database silently keeps an
    // already-applied migration journal — so an edited migration would not
    // re-run and the suite would test stale SQL. A fresh container costs ~2s.
    .start()

  const superUrl = container.getConnectionUri()
  const admin = postgres(superUrl, { max: 1, prepare: false, onnotice: () => {} })

  try {
    // Mirrors db/init/01-roles.sh. Kept in step with it deliberately: if the
    // role model drifts between compose and tests, the tests stop proving
    // anything about production.
    await admin.unsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
          CREATE ROLE app_user NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pof_owner') THEN
          CREATE ROLE pof_owner LOGIN PASSWORD '${OWNER_PASSWORD}';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pof_app') THEN
          CREATE ROLE pof_app LOGIN PASSWORD '${APP_PASSWORD}';
        END IF;
      END $$;
      GRANT app_user TO pof_app;
      GRANT app_user TO pof_owner;
      GRANT ALL ON SCHEMA public TO pof_owner;
      ALTER SCHEMA public OWNER TO pof_owner;
      -- Separate privilege from the schema grant above: Drizzle creates a
      -- "drizzle" schema for its migration journal on first run.
      GRANT CREATE ON DATABASE pof TO pof_owner;
    `)
  } finally {
    await admin.end({ timeout: 5 })
  }

  const host = container.getHost()
  const port = container.getMappedPort(5432)
  const ownerUrl = `postgresql://pof_owner:${OWNER_PASSWORD}@${host}:${port}/pof`
  const appUrl = `postgresql://pof_app:${APP_PASSWORD}@${host}:${port}/pof`

  // Migrations run as the owner, exactly as they do in production.
  const migrator = postgres(ownerUrl, { max: 1, prepare: false, onnotice: () => {} })
  try {
    await migrate(drizzle(migrator), { migrationsFolder })
  } finally {
    await migrator.end({ timeout: 5 })
  }

  provide('appUrl', appUrl)
  provide('ownerUrl', ownerUrl)

  return async () => {
    await container?.stop()
  }
}

// The `ProvidedContext` augmentation lives in ./index.ts so that consuming
// packages (which reference this file only as a vitest config string, and so
// never import it) still see the types by importing '@pof/db/testing'.
