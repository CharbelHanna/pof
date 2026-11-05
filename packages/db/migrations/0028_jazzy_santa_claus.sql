CREATE TYPE "public"."checklist_kind" AS ENUM('gear', 'prep', 'post', 'travel');--> statement-breakpoint
CREATE TABLE "checklist" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"shoot_id" uuid NOT NULL,
	"session_id" uuid,
	"kind" "checklist_kind" DEFAULT 'prep' NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "checklist_workspace_id_id_key" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "checklist_item" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"checklist_id" uuid NOT NULL,
	"label" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"done_at" timestamp with time zone,
	"position" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "checklist_item_workspace_id_id_key" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "checklist" ADD CONSTRAINT "checklist_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist" ADD CONSTRAINT "checklist_shoot_fk" FOREIGN KEY ("workspace_id","shoot_id") REFERENCES "public"."shoot"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist" ADD CONSTRAINT "checklist_session_fk" FOREIGN KEY ("workspace_id","shoot_id","session_id") REFERENCES "public"."shoot_session"("workspace_id","shoot_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_item" ADD CONSTRAINT "checklist_item_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_item" ADD CONSTRAINT "checklist_item_checklist_fk" FOREIGN KEY ("workspace_id","checklist_id") REFERENCES "public"."checklist"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checklist_workspace_shoot_idx" ON "checklist" USING btree ("workspace_id","shoot_id");--> statement-breakpoint
CREATE INDEX "checklist_workspace_shoot_position_idx" ON "checklist" USING btree ("workspace_id","shoot_id","position");--> statement-breakpoint
CREATE INDEX "checklist_workspace_updated_idx" ON "checklist" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "checklist_item_workspace_checklist_idx" ON "checklist_item" USING btree ("workspace_id","checklist_id");--> statement-breakpoint
CREATE INDEX "checklist_item_workspace_checklist_position_idx" ON "checklist_item" USING btree ("workspace_id","checklist_id","position");--> statement-breakpoint
CREATE INDEX "checklist_item_workspace_updated_idx" ON "checklist_item" USING btree ("workspace_id","updated_at");--> statement-breakpoint
-- ===========================================================================
-- Tenant isolation.
-- ===========================================================================
--
-- The helper from 0001: enables and FORCEs row-level security, creates the
-- workspace policy with both USING and WITH CHECK, grants the application
-- role CRUD, and attaches the updated_at trigger.
--
-- Deliberately in the SAME migration as the CREATE TABLE rather than a
-- follow-up one. Splitting them leaves a window — however brief — in which
-- the tables exist with no policy, and a migration that fails halfway would
-- leave them that way indefinitely. Both tables are registered in
-- `tenantTables`, so the isolation suite will fail loudly if this is ever
-- dropped.
SELECT enable_tenant_rls('checklist');--> statement-breakpoint
SELECT enable_tenant_rls('checklist_item');