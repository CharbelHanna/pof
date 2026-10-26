-- ===========================================================================
-- Tenant isolation for the Phase 1 tables.
-- ===========================================================================
--
-- One line per table, using the helper defined in 0001. It enables and FORCEs
-- row-level security, creates the workspace policy with both USING and WITH
-- CHECK, grants the application role CRUD, and attaches the updated_at
-- trigger — so the wording cannot drift between tables.
--
-- Every table added here must also be registered in `tenantTables` in
-- src/schema/index.ts. The isolation suite iterates that map, and a seed is
-- required for each entry, so forgetting one is a compile error rather than a
-- silent gap.

SELECT enable_tenant_rls('campaign');
SELECT enable_tenant_rls('shoot_session');

-- ---------------------------------------------------------------------------
-- shoot_type: deliberately NOT tenant-scoped.
-- ---------------------------------------------------------------------------
-- Global reference data — the same four genres for every workspace, read-only
-- from the application's point of view. There is nothing to isolate, so it
-- gets no policy and is absent from `tenantTables`.
--
-- SELECT only: genres are changed by migration, never by the app. Granting
-- INSERT or UPDATE here would make it possible for one workspace's action to
-- alter what every other workspace sees.
GRANT SELECT ON "shoot_type" TO app_user;

-- ---------------------------------------------------------------------------
-- Index for querying genre-specific fields.
-- ---------------------------------------------------------------------------
-- GIN over the jsonb column. Nothing in Phase 1 filters on `details` — by
-- design, since anything worth filtering on should be promoted to a real
-- column — but this makes the occasional ad-hoc query over a genre field
-- survivable without a sequential scan over every shoot in the database.
CREATE INDEX IF NOT EXISTS shoot_details_gin_idx ON "shoot" USING gin ("details");
