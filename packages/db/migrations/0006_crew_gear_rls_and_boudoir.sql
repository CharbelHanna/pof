-- ===========================================================================
-- Tenant isolation for crew and gear, and the boudoir genre.
-- ===========================================================================
--
-- One line per table, using the helper from 0001: enables and FORCEs
-- row-level security, creates the workspace policy with both USING and WITH
-- CHECK, grants the application role CRUD, and attaches the updated_at
-- trigger. Each is also registered in `tenantTables` in src/schema/index.ts,
-- where the isolation suite picks it up automatically.

SELECT enable_tenant_rls('crew_member');
SELECT enable_tenant_rls('gear_item');
SELECT enable_tenant_rls('shoot_gear');

-- ---------------------------------------------------------------------------
-- Boudoir.
-- ---------------------------------------------------------------------------
-- Adding a genre is an INSERT, which is the whole point of `shoot_type` being
-- a table rather than an enum. The matching field definitions live in
-- @pof/schemas shoot-types/registry.ts.
--
-- Note: the genre's fields help plan the day. They are NOT a record of
-- image-usage consent, which is a legal matter the application does not model
-- yet — see BACKLOG.md.
INSERT INTO "shoot_type" ("key", "label", "description", "sort") VALUES
  ('boudoir', 'Boudoir', 'Intimate portraiture, where privacy and comfort shape the whole day.', 50)
ON CONFLICT ("key") DO NOTHING;
