CREATE TABLE "shot_reference" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"shot_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "shot_reference_workspace_id_id_key" UNIQUE("workspace_id","id"),
	CONSTRAINT "shot_reference_unique_asset_per_shot" UNIQUE("workspace_id","shot_id","asset_id")
);
--> statement-breakpoint
ALTER TABLE "shot_reference" ADD CONSTRAINT "shot_reference_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot_reference" ADD CONSTRAINT "shot_reference_shot_fk" FOREIGN KEY ("workspace_id","shot_id") REFERENCES "public"."shot"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot_reference" ADD CONSTRAINT "shot_reference_asset_fk" FOREIGN KEY ("workspace_id","asset_id") REFERENCES "public"."asset"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shot_reference_workspace_shot_idx" ON "shot_reference" USING btree ("workspace_id","shot_id","position");--> statement-breakpoint
CREATE INDEX "shot_reference_workspace_updated_idx" ON "shot_reference" USING btree ("workspace_id","updated_at");