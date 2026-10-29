CREATE TABLE "location" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"provider" text,
	"provider_id" text,
	"access_notes" text,
	"parking_notes" text,
	"permit_required" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "location_workspace_id_id_key" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "shoot" ADD COLUMN "primary_location_id" uuid;--> statement-breakpoint
ALTER TABLE "shoot_session" ADD COLUMN "location_id" uuid;--> statement-breakpoint
ALTER TABLE "location" ADD CONSTRAINT "location_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "location_workspace_updated_idx" ON "location" USING btree ("workspace_id","updated_at");--> statement-breakpoint
ALTER TABLE "shoot" ADD CONSTRAINT "shoot_primary_location_fk" FOREIGN KEY ("workspace_id","primary_location_id") REFERENCES "public"."location"("workspace_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shoot_session" ADD CONSTRAINT "shoot_session_location_fk" FOREIGN KEY ("workspace_id","location_id") REFERENCES "public"."location"("workspace_id","id") ON DELETE set null ON UPDATE no action;