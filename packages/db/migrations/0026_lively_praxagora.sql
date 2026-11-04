CREATE TABLE "worker_heartbeat" (
	"id" text PRIMARY KEY DEFAULT 'worker' NOT NULL,
	"version" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
