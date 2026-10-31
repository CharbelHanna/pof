-- ===========================================================================
-- Tenant isolation for session locations.
-- ===========================================================================
--
-- One line, using the helper from 0001: enables and FORCEs row-level
-- security, creates the workspace policy with both USING and WITH CHECK,
-- grants the application role CRUD, and attaches the updated_at trigger.
-- `session_location` is registered in `tenantTables` in src/schema/index.ts,
-- where the isolation suite picks it up automatically.
--
-- Separate from 0014 on purpose: FORCE ROW LEVEL SECURITY binds the table
-- owner too, so the backfill in that migration has to complete before this
-- runs or every copied row would be rejected by the policy.

SELECT enable_tenant_rls('session_location');
