-- ===========================================================================
-- Tenant isolation for shot references.
-- ===========================================================================
--
-- The usual helper from 0001: enables and FORCEs row-level security,
-- creates the workspace policy with both USING and WITH CHECK, grants the
-- application role CRUD, and attaches the updated_at trigger.
-- `shot_reference` is registered in `tenantTables`, so the isolation suite
-- picks it up automatically.
SELECT enable_tenant_rls('shot_reference');
