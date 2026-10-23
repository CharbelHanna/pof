#!/bin/bash
# Runs once, on first boot of the Postgres container, as the superuser.
#
# Creates the two roles the application model assumes. On a managed provider
# (Neon, RDS, Azure Database for PostgreSQL) you run the equivalent once by
# hand from their console — this file is the reference for what that means.
#
# Why two roles:
#
#   pof_owner — owns the schema and runs migrations (DDL). Used ONLY by
#               `pnpm db:migrate` via DATABASE_MIGRATION_URL.
#
#   pof_app   — what the application connects as (DATABASE_URL). Owns nothing,
#               so it cannot run DDL, and inherits all of its privileges from
#               the app_user role created by migration 0001. Because it is not
#               the table owner, row-level security applies to it.
#
# app_user is created here as well as in the migration so that the grant below
# can exist at first boot; the migration's CREATE is guarded and becomes a
# no-op. The migration remains the source of truth for what app_user may do.

set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    -- Permission set shared by every application connection.
    DO \$\$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        CREATE ROLE app_user NOLOGIN;
      END IF;
    END
    \$\$;

    CREATE ROLE pof_owner LOGIN PASSWORD '${POF_OWNER_PASSWORD}';
    CREATE ROLE pof_app   LOGIN PASSWORD '${POF_APP_PASSWORD}';

    -- pof_app's privileges come entirely from this membership. Postgres
    -- matches RLS policy roles through inherited membership, so the tenant
    -- policies defined "TO app_user" apply to pof_app automatically.
    GRANT app_user TO pof_app;

    -- The migration role needs to create objects in the schema...
    GRANT ALL ON SCHEMA public TO pof_owner;
    ALTER SCHEMA public OWNER TO pof_owner;

    -- ...and CREATE on the DATABASE itself, which is a separate privilege.
    -- Drizzle keeps its migration journal in a dedicated "drizzle" schema and
    -- creates it on first run; without this the very first migration fails
    -- with "permission denied for database".
    GRANT CREATE ON DATABASE "${POSTGRES_DB}" TO pof_owner;

    -- Let the owner assume app_user, so maintenance scripts can deliberately
    -- run under tenant rules when that is what they want.
    GRANT app_user TO pof_owner;
EOSQL

echo "[init] roles pof_owner, pof_app and app_user ready"
