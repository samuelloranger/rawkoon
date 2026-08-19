-- Prevent two concurrent auto-grabs for the same target.
--
-- Root cause: check-library-movie-releases ("0 */6 * * *") and poll-indexer-rss
-- both fire at :00 every 6 hours and run in parallel (scheduled-tasks worker
-- concurrency 3). Each snapshots the same "wanted + no files" eligibility set,
-- and grabRelease had no in-flight check, so a slow RSS pick (20s of local-AI
-- scoring) grabbed a second release for a movie the other job had already
-- handed to the download client.
--
-- The invariant we want is "at most one ACTIVE download_history row per grab
-- target", where a target is:
--   movie        → (media_id, NULL episode, NULL season)
--   episode      → (media_id, episode_id, NULL season)
--   season pack  → (media_id, NULL episode, season)
--
-- Season packs need their own key: two packs for DIFFERENT seasons of the same
-- show are legitimate concurrent grabs, and both carry episode_id = NULL.

-- 1. Season is the missing part of the grab target for season-pack rows.
ALTER TABLE "download_history"
  ADD COLUMN IF NOT EXISTS "season" INTEGER;

-- 2. Resolve pre-existing duplicates so the unique index can be created.
--    Keep the newest active row per target; mark the older ones failed so the
--    completion poller stops revisiting them (it only looks at
--    completed_at IS NULL AND failed = false).
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY
        "media_id",
        COALESCE("episode_id", -1),
        COALESCE("season", -1)
      ORDER BY "grabbed_at" DESC, "id" DESC
    ) AS rn
  FROM "download_history"
  WHERE "completed_at" IS NULL
    AND "failed" = false
    AND "media_id" IS NOT NULL
)
UPDATE "download_history" AS dh
SET "failed" = true,
    "fail_reason" = COALESCE(
      dh."fail_reason",
      'Superseded by a newer grab for the same item (duplicate active grab resolved by migration)'
    )
FROM ranked
WHERE dh."id" = ranked."id"
  AND ranked.rn > 1;

-- 3. Enforce the invariant. COALESCE keys instead of NULLS NOT DISTINCT so the
--    index works on Postgres < 15, matching the convention already used by
--    20260811000000_reconcile_prod_schema_drift for library_attention_alerts.
--    media_id IS NOT NULL is part of the predicate because the FK is ON DELETE
--    SET NULL — orphaned history rows must not collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS "ux_download_history_active_target"
  ON "download_history" (
    "media_id",
    COALESCE("episode_id", -1),
    COALESCE("season", -1)
  )
  WHERE "completed_at" IS NULL
    AND "failed" = false
    AND "media_id" IS NOT NULL;
