CREATE TABLE "crew_member" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"shoot_id" uuid NOT NULL,
	"session_id" uuid,
	"role" text NOT NULL,
	"name" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "crew_member_workspace_id_id_key" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "gear_item" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "gear_item_workspace_id_id_key" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "shoot_gear" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"shoot_id" uuid NOT NULL,
	"gear_item_id" uuid NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"packed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "shoot_gear_workspace_id_id_key" UNIQUE("workspace_id","id"),
	CONSTRAINT "shoot_gear_unique_item_per_shoot" UNIQUE("workspace_id","shoot_id","gear_item_id")
);
--> statement-breakpoint
ALTER TABLE "crew_member" ADD CONSTRAINT "crew_member_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crew_member" ADD CONSTRAINT "crew_member_shoot_fk" FOREIGN KEY ("workspace_id","shoot_id") REFERENCES "public"."shoot"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Moved ahead of crew_member_session_fk by hand: drizzle-kit emitted the
-- foreign key before the unique constraint it references, and Postgres
-- rejects a composite FK whose target has no matching unique key.
ALTER TABLE "shoot_session" ADD CONSTRAINT "shoot_session_workspace_shoot_id_key" UNIQUE("workspace_id","shoot_id","id");--> statement-breakpoint
ALTER TABLE "crew_member" ADD CONSTRAINT "crew_member_session_fk" FOREIGN KEY ("workspace_id","shoot_id","session_id") REFERENCES "public"."shoot_session"("workspace_id","shoot_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gear_item" ADD CONSTRAINT "gear_item_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shoot_gear" ADD CONSTRAINT "shoot_gear_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shoot_gear" ADD CONSTRAINT "shoot_gear_shoot_fk" FOREIGN KEY ("workspace_id","shoot_id") REFERENCES "public"."shoot"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shoot_gear" ADD CONSTRAINT "shoot_gear_item_fk" FOREIGN KEY ("workspace_id","gear_item_id") REFERENCES "public"."gear_item"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crew_member_workspace_shoot_idx" ON "crew_member" USING btree ("workspace_id","shoot_id");--> statement-breakpoint
CREATE INDEX "crew_member_workspace_updated_idx" ON "crew_member" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "gear_item_workspace_updated_idx" ON "gear_item" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "shoot_gear_workspace_shoot_idx" ON "shoot_gear" USING btree ("workspace_id","shoot_id");--> statement-breakpoint
CREATE INDEX "shoot_gear_workspace_updated_idx" ON "shoot_gear" USING btree ("workspace_id","updated_at");--> statement-breakpoint
