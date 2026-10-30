CREATE TYPE "public"."shot_status" AS ENUM('planned', 'captured', 'skipped');--> statement-breakpoint
CREATE TABLE "shot" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"shoot_id" uuid NOT NULL,
	"session_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"framing" text,
	"subjects" text,
	"props" text,
	"status" "shot_status" DEFAULT 'planned' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "shot_workspace_id_id_key" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "shot" ADD CONSTRAINT "shot_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot" ADD CONSTRAINT "shot_shoot_fk" FOREIGN KEY ("workspace_id","shoot_id") REFERENCES "public"."shoot"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot" ADD CONSTRAINT "shot_session_fk" FOREIGN KEY ("workspace_id","shoot_id","session_id") REFERENCES "public"."shoot_session"("workspace_id","shoot_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shot_workspace_shoot_idx" ON "shot" USING btree ("workspace_id","shoot_id");--> statement-breakpoint
CREATE INDEX "shot_workspace_shoot_position_idx" ON "shot" USING btree ("workspace_id","shoot_id","position");--> statement-breakpoint
CREATE INDEX "shot_workspace_updated_idx" ON "shot" USING btree ("workspace_id","updated_at");