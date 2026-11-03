-- ===========================================================================
-- One saved location per geocoded place, per workspace.
-- ===========================================================================
--
-- `createLocation` guarded only the primary key, which the client mints
-- fresh on every pick, so choosing the same search result twice created a
-- second row. The picker then listed the same place repeatedly, and the
-- copies were indistinguishable — "Parc Heller" existed three times in the
-- development database, all carrying the same OpenStreetMap id.
--
-- The index cannot simply be added: it would fail on those existing rows.
-- So the duplicates are merged first, and merging means repointing whatever
-- already references them rather than deleting rows out from under a
-- foreign key.
--
-- ---------------------------------------------------------------------------
-- FORCE is lifted for the duration, and that is load-bearing
-- ---------------------------------------------------------------------------
-- `location`, `shoot` and `session_location` all have FORCE ROW LEVEL
-- SECURITY, which binds the table owner too, and the tenant policy is
-- granted TO app_user. Migrations run as the owner, so under FORCE these
-- tables read as ZERO ROWS — not an error, just silence. The dedupe would
-- find nothing, report success, and the index would then fail on rows the
-- migration could not see.

ALTER TABLE "location" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shoot" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "session_location" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Survivor per (workspace, provider, provider_id): the lowest id, which for
-- time-ordered UUIDv7 is the one saved first.
CREATE TEMP TABLE location_dedupe AS
SELECT dup.id AS duplicate_id, grouped.survivor_id
  FROM "location" dup
  JOIN (
         SELECT workspace_id,
                provider,
                provider_id,
                min(id::text)::uuid AS survivor_id
           FROM "location"
          WHERE provider_id IS NOT NULL
            AND deleted_at IS NULL
          GROUP BY workspace_id, provider, provider_id
         HAVING count(*) > 1
       ) grouped
    ON dup.workspace_id = grouped.workspace_id
   AND dup.provider IS NOT DISTINCT FROM grouped.provider
   AND dup.provider_id = grouped.provider_id
 WHERE dup.deleted_at IS NULL
   AND dup.id <> grouped.survivor_id;
--> statement-breakpoint

UPDATE "shoot" AS s
   SET primary_location_id = d.survivor_id
  FROM location_dedupe d
 WHERE s.primary_location_id = d.duplicate_id;
--> statement-breakpoint

-- Where a session already visits BOTH a duplicate and its survivor,
-- repointing would violate the one-row-per-location-per-session constraint.
-- Drop the redundant stop rather than fail the migration; the session keeps
-- the place exactly once, which is what the row meant either way.
DELETE FROM "session_location" AS sl
 USING location_dedupe d
 WHERE sl.location_id = d.duplicate_id
   AND EXISTS (
         SELECT 1
           FROM "session_location" keep
          WHERE keep.session_id = sl.session_id
            AND keep.location_id = d.survivor_id
       );
--> statement-breakpoint

UPDATE "session_location" AS sl
   SET location_id = d.survivor_id
  FROM location_dedupe d
 WHERE sl.location_id = d.duplicate_id;
--> statement-breakpoint

DELETE FROM "location" AS l
 USING location_dedupe d
 WHERE l.id = d.duplicate_id;
--> statement-breakpoint

DROP TABLE location_dedupe;--> statement-breakpoint

ALTER TABLE "location" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shoot" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "session_location" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE UNIQUE INDEX "location_workspace_provider_key" ON "location" USING btree ("workspace_id","provider","provider_id") WHERE "location"."provider_id" is not null and "location"."deleted_at" is null;
