-- Query performance pass.
--
-- Two parts:
--   1. Persisted episode rollup columns on library_media, so GET /api/library
--      stops loading every episode (and every episode's files) just to render
--      "12 / 24 episodes, 3 seasons". Same trigger pattern as total_size_bytes.
--   2. The indexes the hot filters and sorts actually need. Every index here is
--      also declared in schema.prisma — nothing is created out-of-band, so
--      `prisma migrate dev` will not see drift and try to drop it.
--
-- Indexes are built non-concurrently: Prisma wraps a migration in one
-- transaction, and CREATE INDEX CONCURRENTLY cannot run there. On a
-- self-hosted library this is seconds; the write lock is on library_media /
-- library_episodes / download_history only.

-- ---------------------------------------------------------------------------
-- 1. Episode rollup columns
-- ---------------------------------------------------------------------------

ALTER TABLE "library_media" ADD COLUMN IF NOT EXISTS "episode_count" INTEGER;
ALTER TABLE "library_media" ADD COLUMN IF NOT EXISTS "downloaded_episode_count" INTEGER;
ALTER TABLE "library_media" ADD COLUMN IF NOT EXISTS "season_count" INTEGER;

-- NULL (not 0) when a media row has no episodes: movies, and shows whose
-- episodes have not been synced yet. Matches what mapLibraryMedia returned
-- when it counted the included episodes in the app.
CREATE OR REPLACE FUNCTION refresh_library_media_episode_counts(p_media_id INT) RETURNS void AS $$
BEGIN
  IF p_media_id IS NULL THEN
    RETURN;
  END IF;
  UPDATE "library_media" lm
  SET
    "episode_count" = NULLIF(agg.total, 0),
    "downloaded_episode_count" = CASE WHEN agg.total = 0 THEN NULL ELSE agg.downloaded END,
    "season_count" = NULLIF(agg.seasons, 0)
  FROM (
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE le."status" = 'downloaded')::int AS downloaded,
      COUNT(DISTINCT le."season")::int AS seasons
    FROM "library_episodes" le
    WHERE le."media_id" = p_media_id
  ) agg
  WHERE lm."id" = p_media_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION library_episodes_refresh_parent_counts() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM refresh_library_media_episode_counts(OLD."media_id");
    RETURN OLD;
  END IF;

  PERFORM refresh_library_media_episode_counts(NEW."media_id");

  IF TG_OP = 'UPDATE' AND OLD."media_id" IS DISTINCT FROM NEW."media_id" THEN
    PERFORM refresh_library_media_episode_counts(OLD."media_id");
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_library_episodes_refresh_parent_counts ON "library_episodes";
CREATE TRIGGER trg_library_episodes_refresh_parent_counts
  AFTER INSERT OR UPDATE OF "media_id", "season", "status" OR DELETE
  ON "library_episodes"
  FOR EACH ROW
  EXECUTE FUNCTION library_episodes_refresh_parent_counts();

-- Backfill in one set-based pass (not one UPDATE per show).
WITH counts AS (
  SELECT
    le."media_id" AS media_id,
    COUNT(*)::int AS total,
    COUNT(*) FILTER (WHERE le."status" = 'downloaded')::int AS downloaded,
    COUNT(DISTINCT le."season")::int AS seasons
  FROM "library_episodes" le
  GROUP BY le."media_id"
)
UPDATE "library_media" lm
SET
  "episode_count" = NULLIF(counts.total, 0),
  "downloaded_episode_count" = CASE WHEN counts.total = 0 THEN NULL ELSE counts.downloaded END,
  "season_count" = NULLIF(counts.seasons, 0)
FROM counts
WHERE counts.media_id = lm."id";

-- ---------------------------------------------------------------------------
-- 2. Indexes
-- ---------------------------------------------------------------------------

-- Every index below was chosen by EXPLAIN (ANALYZE) against a copy of a real
-- production database, at both its current size and an inflated one (13k
-- library_media / 47k download_history / 23k notifications). Candidates the
-- planner never chose, or chose to its own detriment, were dropped rather than
-- shipped; the ones that survived are annotated with the measured effect.

-- Dashboard upcoming filters a digital-release window with no status
-- predicate, so ix_library_media_status cannot serve it: 2.53ms -> 0.04ms.
CREATE INDEX IF NOT EXISTS "ix_library_media_digital_release_date"
  ON "library_media"("digital_release_date");
-- The list endpoint pairs a type filter with a sort column; a single-column
-- sort index cannot serve that. Both are chosen once library_media is large
-- enough (~13k rows) and are ignored harmlessly below that.
CREATE INDEX IF NOT EXISTS "ix_library_media_type_added_at"
  ON "library_media"("type", "added_at");
CREATE INDEX IF NOT EXISTS "ix_library_media_type_list_title"
  ON "library_media"("type", "list_title");

-- library_episodes had no index at all on status / monitored / air_date, which
-- every RSS + release-check cron filters on: 0.44ms -> 0.03ms.
CREATE INDEX IF NOT EXISTS "ix_library_episodes_status_monitored_air_date"
  ON "library_episodes"("status", "monitored", "air_date");
-- Dashboard upcoming episodes, air-date window only: 0.42ms -> 0.17ms.
CREATE INDEX IF NOT EXISTS "ix_library_episodes_air_date"
  ON "library_episodes"("air_date");

-- The completion poller reads {completed_at: null, failed: false} every ~20s
-- over a table that only grows. This must be PARTIAL, not a plain
-- (completed_at, failed) composite: measured at 47k rows the composite left the
-- planner preferring ix_download_history_failed_grabbed_at (it satisfies the
-- ORDER BY) and filtering 44,634 rows away — 12.6ms and 32,387 buffers. The
-- partial index below satisfies the filter AND the sort: 0.014ms, 2 buffers.
--
-- Prisma cannot express a partial index, so this one is not in schema.prisma.
-- That is safe: Prisma omits partial indexes from introspection, so
-- `prisma migrate diff` reports "No difference detected" with it present
-- (verified against a migrated database) and will not generate a DROP for it.
CREATE INDEX IF NOT EXISTS "ix_download_history_active_grabbed_at"
  ON "download_history"("grabbed_at")
  WHERE "completed_at" IS NULL AND "failed" = false;
CREATE INDEX IF NOT EXISTS "ix_download_history_grabbed_at"
  ON "download_history"("grabbed_at" DESC);
-- Attention-candidate windows over failed grabs: 0.11ms -> 0.04ms.
CREATE INDEX IF NOT EXISTS "ix_download_history_failed_grabbed_at"
  ON "download_history"("failed", "grabbed_at" DESC);

-- Unread badge count becomes an index-only scan; paged inbox 0.21ms -> 0.03ms
-- at 23k notifications. Both are ignored while the table is small.
CREATE INDEX IF NOT EXISTS "ix_notifications_user_id_read"
  ON "notifications"("user_id", "read");
CREATE INDEX IF NOT EXISTS "ix_notifications_user_id_created_at"
  ON "notifications"("user_id", "created_at" DESC);

-- These three match the real query shapes but are not yet chosen: the tables
-- hold 61 / 0 / 0 rows in production, where a seq scan legitimately wins. Kept
-- because they total ~40 kB and these tables grow with normal use.
CREATE INDEX IF NOT EXISTS "ix_library_attention_alert_status_updated_at"
  ON "library_attention_alerts"("status", "updated_at" DESC);
CREATE INDEX IF NOT EXISTS "ix_grab_blocklist_blocked_at"
  ON "grab_blocklist"("blocked_at" DESC);
CREATE INDEX IF NOT EXISTS "ix_media_request_status_created_at"
  ON "media_requests"("status", "created_at" DESC);
