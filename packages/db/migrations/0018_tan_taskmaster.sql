CREATE TYPE "public"."asset_status" AS ENUM('pending', 'uploaded', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "asset" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" bigint,
	"filename" text,
	"width" integer,
	"height" integer,
	"status" "asset_status" DEFAULT 'pending' NOT NULL,
	"failure_reason" text,
	"variants" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"captured_at" timestamp with time zone,
	"latitude" double precision,
	"longitude" double precision,
	"uploaded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "asset_workspace_id_id_key" UNIQUE("workspace_id","id"),
	CONSTRAINT "asset_storage_key_key" UNIQUE("storage_key")
);
--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_workspace_updated_idx" ON "asset" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "asset_workspace_status_idx" ON "asset" USING btree ("workspace_id","status");