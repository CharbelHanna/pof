-- Tenant isolation for locations.
--
-- One line, using the helper from 0001: enables and FORCEs row-level
-- security, creates the workspace policy with both USING and WITH CHECK,
-- grants the application role CRUD, and attaches the updated_at trigger.
-- Registered in `tenantTables` too, so the isolation suite covers it.
SELECT enable_tenant_rls('location');
