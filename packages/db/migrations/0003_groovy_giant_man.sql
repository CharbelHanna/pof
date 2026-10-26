CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'active', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('planned', 'confirmed', 'in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE "campaign" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"brief" text,
	"status" "campaign_status" DEFAULT 'draft' NOT NULL,
	"starts_on" date,
	"ends_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "campaign_workspace_id_id_key" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "shoot_session" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"shoot_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" "session_status" DEFAULT 'planned' NOT NULL,
	"notes" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "shoot_session_workspace_id_id_key" UNIQUE("workspace_id","id"),
	CONSTRAINT "shoot_session_ends_after_starts" CHECK ("shoot_session"."ends_at" > "shoot_session"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "shoot_type" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
-- Seed the genres BEFORE the foreign key below is added.
--
-- `shoot.shoot_type_key` already exists and defaults to 'portrait', so every
-- row written in Phase 0 carries that value. Adding the foreign key against an
-- empty shoot_type would fail validation on existing data. Hand-written here
-- rather than generated: drizzle-kit describes schema, not the reference rows
-- the schema depends on.
--
-- Keep in step with the registry in @pof/schemas shoot-types/registry.ts. A
-- test asserts the two agree, so drift fails the build rather than surfacing
-- as a foreign-key violation at runtime.
INSERT INTO "shoot_type" ("key", "label", "description", "sort") VALUES
  ('portrait',  'Portrait',  'People — headshots, personal branding, portfolio work.',        10),
  ('editorial', 'Editorial', 'Commissioned work for a publication or brand story.',           20),
  ('landscape', 'Landscape', 'Outdoor and location work where light and access decide the day.', 30),
  ('product',   'Product',   'Catalogue, packshot and still-life work, usually at volume.',   40)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
ALTER TABLE "shoot" ADD COLUMN "campaign_id" uuid;--> statement-breakpoint
ALTER TABLE "shoot" ADD COLUMN "delivery_date" date;--> statement-breakpoint
ALTER TABLE "shoot" ADD COLUMN "details" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "shoot" ADD COLUMN "details_schema_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shoot_session" ADD CONSTRAINT "shoot_session_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shoot_session" ADD CONSTRAINT "shoot_session_shoot_fk" FOREIGN KEY ("workspace_id","shoot_id") REFERENCES "public"."shoot"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_workspace_updated_idx" ON "campaign" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "shoot_session_workspace_shoot_idx" ON "shoot_session" USING btree ("workspace_id","shoot_id");--> statement-breakpoint
CREATE INDEX "shoot_session_workspace_updated_idx" ON "shoot_session" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "shoot_session_workspace_starts_idx" ON "shoot_session" USING btree ("workspace_id","starts_at");--> statement-breakpoint
ALTER TABLE "shoot" ADD CONSTRAINT "shoot_shoot_type_key_shoot_type_key_fk" FOREIGN KEY ("shoot_type_key") REFERENCES "public"."shoot_type"("key") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "shoot" ADD CONSTRAINT "shoot_campaign_fk" FOREIGN KEY ("workspace_id","campaign_id") REFERENCES "public"."campaign"("workspace_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shoot_workspace_campaign_idx" ON "shoot" USING btree ("workspace_id","campaign_id");