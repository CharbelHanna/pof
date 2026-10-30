-- ===========================================================================
-- Tenant isolation for per-shot gear requirements.
-- ===========================================================================
--
-- One line, using the helper from 0001: enables and FORCEs row-level
-- security, creates the workspace policy with both USING and WITH CHECK,
-- grants the application role CRUD, and attaches the updated_at trigger.
-- `shot_gear_requirement` is registered in `tenantTables` in
-- src/schema/index.ts, where the isolation suite picks it up automatically.

SELECT enable_tenant_rls('shot_gear_requirement');
