-- ===========================================================================
-- Tenant isolation: roles, row-level security, and the updated_at trigger.
-- ===========================================================================
--
-- This migration owns the PERMISSION MODEL. It deliberately does not create
-- any login role or password: credentials are infrastructure (see the
-- db/init/ script used by docker-compose, or your managed provider's console),
-- and must never live in version control.
--
-- The contract with infrastructure is exactly one line:
--
--     GRANT app_user TO <the role in DATABASE_URL>;
--
-- Everything else — what that role may touch, and which rows it may see — is
-- defined here and travels with the schema.

-- ---------------------------------------------------------------------------
-- 1. The application role.
-- ---------------------------------------------------------------------------
-- NOLOGIN: this is a permission set, not an account. The login role inherits
-- it. Because Postgres matches policy roles through inherited membership
-- (pg_has_role), the policies below apply to the login role automatically —
-- `SET LOCAL ROLE app_user` in withTenant is defence in depth, not the
-- mechanism.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO app_user;

-- ---------------------------------------------------------------------------
-- 2. updated_at maintenance.
-- ---------------------------------------------------------------------------
-- A trigger rather than application code, deliberately: incremental sync
-- (`updatedSince` + tombstones, Phase 8) is only correct if updated_at ALWAYS
-- advances — including for a one-off UPDATE typed into psql during an
-- incident. Application-maintained timestamps silently miss those.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. The helper that makes a table tenant-scoped.
-- ---------------------------------------------------------------------------
-- Every future domain table becomes one call to this function. Centralising it
-- means the policy wording cannot drift between tables, and reviewing "is this
-- table protected?" is reading one line instead of twenty.
--
-- Notes on the policy itself:
--
--   * nullif(current_setting('app.workspace_id', true), '')::uuid — an
--     unscoped query must match ZERO rows, and this is fiddlier than it looks.
--     The `true` argument means "return NULL instead of raising if the setting
--     is undefined". But a GUC that HAS been set transaction-locally earlier
--     on the same pooled connection does not revert to undefined — it reverts
--     to the empty string. `''::uuid` then raises 22P02 instead of yielding
--     NULL, so the policy's behaviour would depend on whether that particular
--     connection had previously served a tenant transaction. The `nullif`
--     collapses both the never-set and the reset-to-empty cases to NULL, so
--     the comparison is NULL, so no rows match. Fails closed, deterministically.
--
--   * FORCE ROW LEVEL SECURITY — without FORCE, the table owner bypasses RLS
--     entirely and silently. That is the single most dangerous misconfiguration
--     available here: point DATABASE_URL at the owner and isolation vanishes
--     with no error anywhere. FORCE removes that failure mode.
--
--   * Both USING and WITH CHECK — USING governs what is visible to
--     SELECT/UPDATE/DELETE; WITH CHECK governs what INSERT/UPDATE may write.
--     Omitting WITH CHECK would let a tenant insert rows *into* another
--     workspace while being unable to read them back.
CREATE OR REPLACE FUNCTION enable_tenant_rls(target_table regclass)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  policy_name text := format('%s_tenant_isolation', target_table::text);
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', target_table);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', target_table);

  EXECUTE format('DROP POLICY IF EXISTS %I ON %s', policy_name, target_table);
  EXECUTE format(
    'CREATE POLICY %I ON %s AS PERMISSIVE FOR ALL TO app_user '
    'USING (workspace_id = nullif(current_setting(''app.workspace_id'', true), '''')::uuid) '
    'WITH CHECK (workspace_id = nullif(current_setting(''app.workspace_id'', true), '''')::uuid)',
    policy_name, target_table
  );

  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %s TO app_user', target_table);

  EXECUTE format(
    'DROP TRIGGER IF EXISTS %I ON %s',
    format('%s_set_updated_at', target_table::text), target_table
  );
  EXECUTE format(
    'CREATE TRIGGER %I BEFORE UPDATE ON %s '
    'FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
    format('%s_set_updated_at', target_table::text), target_table
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Auth tables.
-- ---------------------------------------------------------------------------
-- Better Auth's tables are NOT tenant-scoped and get no policy: authentication
-- has to resolve a session token, an email, or a user's organization list
-- before any workspace context exists. A tenant policy here would make login
-- impossible.
--
-- They still need grants, because the application role's privileges come
-- entirely from app_user membership.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  "user", "session", "account", "verification",
  "organization", "member", "invitation"
TO app_user;

-- organization/member/invitation are reachable only through Better Auth's own
-- endpoints, which scope by the authenticated user. The domain layer never
-- queries them directly for tenant data.

-- ---------------------------------------------------------------------------
-- 5. Domain tables.
-- ---------------------------------------------------------------------------
-- One line per table. Add every new domain table here AND to `tenantTables` in
-- src/schema/index.ts — the isolation suite iterates that map and will fail if
-- a registered table turns out to be unprotected.
SELECT enable_tenant_rls('shoot');
