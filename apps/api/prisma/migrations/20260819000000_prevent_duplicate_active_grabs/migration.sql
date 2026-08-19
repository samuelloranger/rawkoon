-- Prevent two concurrent auto-grabs for the same target.
--
-- Root cause: check-library-movie-releases ("0 */6 * * *") and poll-indexer-rss
-- both fired at :00 every 6 hours and ran in parallel (scheduled-tasks worker
-- concurrency 3). Each snapshotted the same "wanted + no files" eligibility set,
-- and grabRelease had no in-flight check, so a slow release pick (tens of
-- seconds of local-AI scoring) grabbed a second release for a movie the other
-- job had already handed to the download client.
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

-- 2. Backfill season on ACTIVE season-pack rows grabbed before the column
--    existed. Without this, every pre-existing pack row has season = NULL, so
--    step 3 would treat packs for different seasons of one show as the same
--    target and fail all but the newest — and a failed row is invisible to
--    checkDownloadCompletion, so a legitimately running download would never be
--    imported.
--
--    A pack is a show row with no episode_id whose release title carries a
--    season token (S03 / Season 3 / Saison 3) but no episode token (S03E04).
UPDATE "download_history" AS dh
SET "season" = (
  regexp_match(
    dh."release_title",
    '(?:^|[^[:alnum:]])(?:[Ss]aison[[:space:]._-]*|[Ss]eason[[:space:]._-]*|[Ss])([0-9]{1,2})(?:[^0-9]|$)'
  )
)[1]::int
WHERE dh."season" IS NULL
  AND dh."episode_id" IS NULL
  AND dh."media_id" IS NOT NULL
  AND dh."completed_at" IS NULL
  AND dh."failed" = false
  AND EXISTS (
    SELECT 1 FROM "library_media" m
    WHERE m."id" = dh."media_id" AND m."type" = 'show'
  )
  AND dh."release_title" ~ '(?:^|[^[:alnum:]])(?:[Ss]aison[[:space:]._-]*|[Ss]eason[[:space:]._-]*|[Ss])[0-9]{1,2}(?:[^0-9]|$)'
  AND dh."release_title" !~ '(?:^|[^[:alnum:]])[Ss][0-9]{1,2}[[:space:]._-]*[Ee][0-9]{1,3}';

-- 3. Resolve whatever duplicates remain so the unique index can be created.
--    Keep the newest active row per target; mark the older ones failed so the
--    completion poller stops revisiting them (it only looks at
--    completed_at IS NULL AND failed = false).
--
--    After the backfill this should touch only true duplicates, but a pack whose
--    season could not be parsed from its title can still land here — so name the
--    affected rows in the migration output rather than failing them silently.
DO $$
DECLARE
  superseded INT[];
BEGIN
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
  ), updated AS (
    UPDATE "download_history" AS dh
    SET "failed" = true,
        "fail_reason" = COALESCE(
          dh."fail_reason",
          'Superseded by a newer grab for the same item (duplicate active grab resolved by migration)'
        )
    FROM ranked
    WHERE dh."id" = ranked."id"
      AND ranked.rn > 1
    RETURNING dh."id"
  )
  SELECT array_agg("id") INTO superseded FROM updated;

  IF superseded IS NOT NULL THEN
    RAISE NOTICE 'download_history rows marked failed as duplicate active grabs: %. If any of these is still running in the download client, remove it there — a failed row is no longer polled for completion.', superseded;
  END IF;
END $$;

-- 4. Enforce the invariant. COALESCE keys instead of NULLS NOT DISTINCT so the
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
