-- ===========================================================================
-- A session can have many locations, in a planned order.
-- ===========================================================================
--
-- `shoot_session.location_id` allowed exactly one. A landscape session is
-- normally a route — park at the layby, walk to the lochside for blue hour,
-- climb to the ridge for sunrise — and one column meant the other stops lived
-- in free text where nothing could compute sun times or map them.
--
-- ORDER MATTERS IN THIS FILE. The generated migration dropped the column
-- immediately, which would have discarded every location already assigned to
-- a session. The existing values are copied into the new table first, and
-- only then is the column dropped.
--
-- Row-level security for the new table is enabled in the NEXT migration, not
-- here, and that is deliberate: `enable_tenant_rls` applies FORCE ROW LEVEL
-- SECURITY, which binds the table owner too. Running the backfill after that
-- would mean inserting as the owner with no `app.workspace_id` set, and every
-- row would be rejected by the policy.

CREATE TABLE "session_location" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "session_location_workspace_id_id_key" UNIQUE("workspace_id","id"),
	CONSTRAINT "session_location_unique_per_session" UNIQUE("workspace_id","session_id","location_id")
);
--> statement-breakpoint
ALTER TABLE "session_location" ADD CONSTRAINT "session_location_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_location" ADD CONSTRAINT "session_location_session_fk" FOREIGN KEY ("workspace_id","session_id") REFERENCES "public"."shoot_session"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_location" ADD CONSTRAINT "session_location_location_fk" FOREIGN KEY ("workspace_id","location_id") REFERENCES "public"."location"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_location_workspace_session_idx" ON "session_location" USING btree ("workspace_id","session_id","position");--> statement-breakpoint
CREATE INDEX "session_location_workspace_updated_idx" ON "session_location" USING btree ("workspace_id","updated_at");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Carry every existing session location across as the first stop.
-- ---------------------------------------------------------------------------
-- Position 0 makes it the primary location, which is what sun times and the
-- map centre on — so a session that had one location behaves exactly as it
-- did before.
--
-- The FORCE is lifted for the duration of the copy, and this is load-bearing
-- rather than tidying. `shoot_session` has FORCE ROW LEVEL SECURITY, which
-- binds the table owner as well, and the tenant policy is granted TO
-- app_user. Migrations run as the owner, which is not a member of app_user,
-- so under FORCE no policy applies to it and the table reads as EMPTY — not
-- an error, just zero rows. Verified against a real row before writing this:
-- the SELECT below returned nothing, so the copy would have silently moved
-- no data and the DROP COLUMN underneath would have destroyed every session
-- location in the database.
--
-- NO FORCE does not disable RLS; it restores the normal rule that a table's
-- owner bypasses it. app_user is unaffected throughout, and the FORCE is put
-- back immediately. The migration runs in a transaction, so a failure in
-- between rolls the whole thing back rather than leaving the table exposed.
ALTER TABLE "shoot_session" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

INSERT INTO "session_location" ("workspace_id", "session_id", "location_id", "position")
SELECT "workspace_id", "id", "location_id", 0
FROM "shoot_session"
WHERE "location_id" IS NOT NULL;
--> statement-breakpoint

ALTER TABLE "shoot_session" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

ALTER TABLE "shoot_session" DROP CONSTRAINT "shoot_session_location_fk";--> statement-breakpoint
ALTER TABLE "shoot_session" DROP COLUMN "location_id";
