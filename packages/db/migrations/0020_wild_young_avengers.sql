CREATE TABLE "moodboard" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"shoot_id" uuid NOT NULL,
	"name" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "moodboard_workspace_id_id_key" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "moodboard_item" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"moodboard_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"caption" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "moodboard_item_workspace_id_id_key" UNIQUE("workspace_id","id"),
	CONSTRAINT "moodboard_item_unique_asset_per_board" UNIQUE("workspace_id","moodboard_id","asset_id")
);
--> statement-breakpoint
ALTER TABLE "moodboard" ADD CONSTRAINT "moodboard_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moodboard" ADD CONSTRAINT "moodboard_shoot_fk" FOREIGN KEY ("workspace_id","shoot_id") REFERENCES "public"."shoot"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moodboard_item" ADD CONSTRAINT "moodboard_item_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moodboard_item" ADD CONSTRAINT "moodboard_item_board_fk" FOREIGN KEY ("workspace_id","moodboard_id") REFERENCES "public"."moodboard"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moodboard_item" ADD CONSTRAINT "moodboard_item_asset_fk" FOREIGN KEY ("workspace_id","asset_id") REFERENCES "public"."asset"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "moodboard_workspace_shoot_idx" ON "moodboard" USING btree ("workspace_id","shoot_id");--> statement-breakpoint
CREATE INDEX "moodboard_workspace_updated_idx" ON "moodboard" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "moodboard_item_workspace_board_idx" ON "moodboard_item" USING btree ("workspace_id","moodboard_id","position");--> statement-breakpoint
CREATE INDEX "moodboard_item_workspace_updated_idx" ON "moodboard_item" USING btree ("workspace_id","updated_at");