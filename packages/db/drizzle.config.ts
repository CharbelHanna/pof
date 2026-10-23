import { defineConfig } from 'drizzle-kit'

/**
 * Migrations are generated to checked-in SQL and applied by an explicit
 * runner (src/migrate.ts) from the container entrypoint. No platform-specific
 * migration hook, and never `drizzle-kit push` outside local experimentation —
 * push diffs against a live database and will happily drop a column.
 *
 * DDL runs as the schema owner, which is a *different* role from the one the
 * application connects as. See migrations/0001_roles_and_rls.sql.
 */
export default defineConfig({
  schema: './src/schema/index.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL ?? '',
  },
  strict: true,
  verbose: true,
})
