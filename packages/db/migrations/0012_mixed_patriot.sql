CREATE TABLE "shot_gear_requirement" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"shot_id" uuid NOT NULL,
	"gear_item_id" uuid NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "shot_gear_requirement_workspace_id_id_key" UNIQUE("workspace_id","id"),
	CONSTRAINT "shot_gear_requirement_unique_item_per_shot" UNIQUE("workspace_id","shot_id","gear_item_id")
);
--> statement-breakpoint
ALTER TABLE "shot_gear_requirement" ADD CONSTRAINT "shot_gear_requirement_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot_gear_requirement" ADD CONSTRAINT "shot_gear_requirement_shot_fk" FOREIGN KEY ("workspace_id","shot_id") REFERENCES "public"."shot"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot_gear_requirement" ADD CONSTRAINT "shot_gear_requirement_item_fk" FOREIGN KEY ("workspace_id","gear_item_id") REFERENCES "public"."gear_item"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shot_gear_requirement_workspace_shot_idx" ON "shot_gear_requirement" USING btree ("workspace_id","shot_id");--> statement-breakpoint
CREATE INDEX "shot_gear_requirement_workspace_updated_idx" ON "shot_gear_requirement" USING btree ("workspace_id","updated_at");