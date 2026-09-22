-- Cleanup release: queue janitor + seeding lifecycle. Additive only.

ALTER TABLE "download_history"
  ADD COLUMN "seed_released_at" TIMESTAMP(3),
  ADD COLUMN "seed_release_reason" TEXT,
  ADD COLUMN "seed_released_bytes" BIGINT;

-- Partial, like ix_download_history_active_grabbed_at: the sweep reads only
-- completed, unreleased, non-failed rows of a table that only grows.
CREATE INDEX "ix_download_history_seed_pending"
  ON "download_history" ("torrent_hash")
  WHERE "seed_released_at" IS NULL AND "completed_at" IS NOT NULL AND "failed" = false;

ALTER TABLE "grab_blocklist" ADD COLUMN "kind" TEXT;
CREATE INDEX "ix_grab_blocklist_kind_blocked_at" ON "grab_blocklist" ("kind", "blocked_at");

CREATE TABLE "indexer_seed_rule" (
  "id" SERIAL NOT NULL,
  "indexer_name" TEXT NOT NULL,
  "ratio" DOUBLE PRECISION,
  "seed_time_mins" INTEGER,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "indexer_seed_rule_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "indexer_seed_rule_indexer_name_key" ON "indexer_seed_rule" ("indexer_name");

ALTER TABLE "media_settings"
  ADD COLUMN "public_seed_time_mins" INTEGER,
  ADD COLUMN "private_seed_ratio" DOUBLE PRECISION DEFAULT 1,
  ADD COLUMN "private_seed_time_mins" INTEGER DEFAULT 4320,
  ADD COLUMN "seed_sweep_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "blocked_extensions" TEXT[] DEFAULT ARRAY['exe','scr','lnk','bat','cmd','com','msi','pif','vbs','ps1','jar','apk']::TEXT[];
