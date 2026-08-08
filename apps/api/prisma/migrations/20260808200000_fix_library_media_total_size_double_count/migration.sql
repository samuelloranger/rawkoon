-- Fix library_media.total_size_bytes double-counting every episode file.
--
-- 20260806040000 summed media_files twice: once by media_files.media_id and
-- once by joining library_episodes on media_files.episode_id. Episode files
-- carry BOTH columns (see rescan.ts / postProcessorSingle.ts), so each one was
-- added to its show twice — every show row was exactly 2x its real size.
--
-- A file now belongs to exactly one parent, matching what the trigger already
-- assumes in media_files_resolve_media_id(): media_id when set, otherwise the
-- episode's media_id.

CREATE OR REPLACE FUNCTION refresh_library_media_total_size(p_media_id INT) RETURNS void AS $$
BEGIN
  IF p_media_id IS NULL THEN
    RETURN;
  END IF;
  UPDATE "library_media" lm
  SET "total_size_bytes" = NULLIF(
    COALESCE((
      -- Disjoint by construction (media_id IS NULL vs NOT NULL), so a file is
      -- summed once even when it carries both media_id and episode_id.
      SELECT SUM(t."size_bytes") FROM (
        SELECT mf."size_bytes"
        FROM "media_files" mf
        WHERE mf."media_id" = p_media_id
        UNION ALL
        SELECT mf."size_bytes"
        FROM "media_files" mf
        JOIN "library_episodes" le ON le."id" = mf."episode_id"
        WHERE mf."media_id" IS NULL AND le."media_id" = p_media_id
      ) t
    ), 0),
    0
  )
  WHERE lm."id" = p_media_id;
END;
$$ LANGUAGE plpgsql;

-- Backfill every row with the corrected aggregate (set-based, one pass).
UPDATE "library_media" lm
SET "total_size_bytes" = NULL
WHERE lm."total_size_bytes" IS NOT NULL;

WITH sums AS (
  SELECT
    COALESCE(mf."media_id", le."media_id") AS media_id,
    SUM(mf."size_bytes") AS total
  FROM "media_files" mf
  LEFT JOIN "library_episodes" le ON le."id" = mf."episode_id"
  WHERE COALESCE(mf."media_id", le."media_id") IS NOT NULL
  GROUP BY 1
)
UPDATE "library_media" lm
SET "total_size_bytes" = NULLIF(sums.total, 0)
FROM sums
WHERE sums.media_id = lm."id";
