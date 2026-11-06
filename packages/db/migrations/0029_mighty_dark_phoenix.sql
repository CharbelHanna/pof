CREATE TYPE "public"."template_item_kind" AS ENUM('shot', 'checklist_item');--> statement-breakpoint
CREATE TABLE "session_template" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"shoot_type_key" text,
	"current_version" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "session_template_workspace_id_id_key" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "session_template_version" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_template_version_number_key" UNIQUE("workspace_id","template_id","version"),
	CONSTRAINT "session_template_version_workspace_id_id_key" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "template_item" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"kind" "template_item_kind" NOT NULL,
	"payload" jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "template_item_workspace_id_id_key" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "shoot_session" ADD COLUMN "applied_template_id" uuid;--> statement-breakpoint
ALTER TABLE "shoot_session" ADD COLUMN "applied_template_version" integer;--> statement-breakpoint
ALTER TABLE "shot" ADD COLUMN "source_template_item_id" uuid;--> statement-breakpoint
ALTER TABLE "checklist_item" ADD COLUMN "source_template_item_id" uuid;--> statement-breakpoint
ALTER TABLE "session_template" ADD CONSTRAINT "session_template_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_template" ADD CONSTRAINT "session_template_shoot_type_key_shoot_type_key_fk" FOREIGN KEY ("shoot_type_key") REFERENCES "public"."shoot_type"("key") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_template_version" ADD CONSTRAINT "session_template_version_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_template_version" ADD CONSTRAINT "session_template_version_template_fk" FOREIGN KEY ("workspace_id","template_id") REFERENCES "public"."session_template"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_item" ADD CONSTRAINT "template_item_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_item" ADD CONSTRAINT "template_item_version_fk" FOREIGN KEY ("workspace_id","version_id") REFERENCES "public"."session_template_version"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_template_workspace_idx" ON "session_template" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "session_template_workspace_updated_idx" ON "session_template" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "session_template_version_workspace_template_idx" ON "session_template_version" USING btree ("workspace_id","template_id");--> statement-breakpoint
CREATE INDEX "template_item_workspace_version_idx" ON "template_item" USING btree ("workspace_id","version_id");--> statement-breakpoint
CREATE INDEX "template_item_workspace_version_position_idx" ON "template_item" USING btree ("workspace_id","version_id","position");--> statement-breakpoint
-- ===========================================================================
-- Tenant isolation.
-- ===========================================================================
--
-- The helper from 0001: enables and FORCEs row-level security, creates the
-- workspace policy with both USING and WITH CHECK, grants the application
-- role CRUD, and attaches the updated_at trigger.
--
-- In the same migration as the CREATE TABLE, so the tables never exist
-- unprotected. All three are registered in `tenantTables`, so the isolation
-- suite fails loudly if this is dropped.
SELECT enable_tenant_rls('session_template');--> statement-breakpoint
SELECT enable_tenant_rls('session_template_version');--> statement-breakpoint
SELECT enable_tenant_rls('template_item');
