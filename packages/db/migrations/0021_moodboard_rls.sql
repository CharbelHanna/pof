-- ===========================================================================
-- Tenant isolation for moodboards and their items.
-- ===========================================================================
--
-- One line per table, using the helper from 0001: enables and FORCEs
-- row-level security, creates the workspace policy with both USING and WITH
-- CHECK, grants the application role CRUD, and attaches the updated_at
-- trigger. Both are registered in `tenantTables` in src/schema/index.ts,
-- where the isolation suite picks them up automatically.
--
-- The same caveat as `asset` applies here and is worth repeating: this
-- governs the TABLES. The images themselves live in object storage, which
-- row-level security does not reach. A board is only as private as the keys
-- of the assets on it.
SELECT enable_tenant_rls('moodboard');
SELECT enable_tenant_rls('moodboard_item');
