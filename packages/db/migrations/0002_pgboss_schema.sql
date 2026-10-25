-- ===========================================================================
-- A scoped home for pg-boss.
-- ===========================================================================
--
-- The worker's queue library creates and migrates its own tables, which needs
-- CREATE privilege. The application role deliberately does NOT have CREATE on
-- the database — that is the whole point of connecting as an unprivileged,
-- non-owning role so row-level security applies to it.
--
-- Widening the application role's privileges to satisfy the queue would trade
-- away the tenancy guarantee for convenience. Instead, give pg-boss a
-- dedicated schema that app_user OWNS. Ownership of one schema lets it create
-- exactly the tables it needs, inside that schema and nowhere else: it still
-- cannot create anything in `public`, and still cannot bypass RLS on the
-- domain tables.
--
-- The queue tables are intentionally outside the tenant model. Jobs are
-- infrastructure, not domain data, and carry `workspaceId` in their PAYLOAD —
-- every handler must open `withTenant` with it before touching domain tables.
-- A worker runs with no request and therefore no session, which makes this the
-- most likely place in the codebase for a cross-tenant mistake.

CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION app_user;

-- Harmless if pg-boss is not yet installed; makes the intent explicit.
GRANT USAGE, CREATE ON SCHEMA pgboss TO app_user;
