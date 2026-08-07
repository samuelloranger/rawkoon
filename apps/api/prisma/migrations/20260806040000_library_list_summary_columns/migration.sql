-- Persisted summary / display-sort columns so GET /api/library can Prisma
-- orderBy + skip/take (no app $queryRaw). Kept in sync by triggers.

ALTER TABLE "library_media" ADD COLUMN IF NOT EXISTS "last_grabbed_at" TIMESTAMP(3);
ALTER TABLE "library_media" ADD COLUMN IF NOT EXISTS "total_size_bytes" BIGINT;
ALTER TABLE "library_media" ADD COLUMN IF NOT EXISTS "list_title" TEXT NOT NULL DEFAULT '';
ALTER TABLE "library_media" ADD COLUMN IF NOT EXISTS "list_year" INTEGER;

-- Backfill list title / year (override-aware)
UPDATE "library_media" lm
SET
  "list_title" = CASE
    WHEN jsonb_typeof(lm."overrides"->'title') = 'string' THEN lm."overrides"->>'title'
    ELSE lm."title"
  END,
  "list_year" = CASE
    WHEN jsonb_typeof(lm."overrides"->'year') = 'number' THEN (lm."overrides"->>'year')::int
    ELSE lm."year"
  END;

-- Backfill last_grabbed_at
UPDATE "library_media" lm
SET "last_grabbed_at" = (
  SELECT MAX(dh."grabbed_at")
  FROM "download_history" dh
  WHERE dh."media_id" = lm."id"
);

-- Backfill total_size_bytes (movie files + episode files; 0 → NULL)
UPDATE "library_media" lm
SET "total_size_bytes" = NULLIF(
  COALESCE((
    SELECT SUM(mf."size_bytes")
    FROM "media_files" mf
    WHERE mf."media_id" = lm."id"
  ), 0) + COALESCE((
    SELECT SUM(mf."size_bytes")
    FROM "library_episodes" le
    JOIN "media_files" mf ON mf."episode_id" = le."id"
    WHERE le."media_id" = lm."id"
  ), 0),
  0
);

CREATE INDEX IF NOT EXISTS "ix_library_media_last_grabbed_at" ON "library_media"("last_grabbed_at");
CREATE INDEX IF NOT EXISTS "ix_library_media_total_size_bytes" ON "library_media"("total_size_bytes");
CREATE INDEX IF NOT EXISTS "ix_library_media_list_title" ON "library_media"("list_title");
CREATE INDEX IF NOT EXISTS "ix_library_media_list_year" ON "library_media"("list_year");

-- Keep list_title / list_year in sync with title, year, overrides
CREATE OR REPLACE FUNCTION library_media_set_list_fields() RETURNS trigger AS $$
BEGIN
  IF jsonb_typeof(NEW."overrides"->'title') = 'string' THEN
    NEW."list_title" := NEW."overrides"->>'title';
  ELSE
    NEW."list_title" := NEW."title";
  END IF;
  IF jsonb_typeof(NEW."overrides"->'year') = 'number' THEN
    NEW."list_year" := (NEW."overrides"->>'year')::int;
  ELSE
    NEW."list_year" := NEW."year";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_library_media_set_list_fields ON "library_media";
CREATE TRIGGER trg_library_media_set_list_fields
  BEFORE INSERT OR UPDATE OF "title", "year", "overrides"
  ON "library_media"
  FOR EACH ROW
  EXECUTE FUNCTION library_media_set_list_fields();

CREATE OR REPLACE FUNCTION refresh_library_media_total_size(p_media_id INT) RETURNS void AS $$
BEGIN
  IF p_media_id IS NULL THEN
    RETURN;
  END IF;
  UPDATE "library_media" lm
  SET "total_size_bytes" = NULLIF(
    COALESCE((
      SELECT SUM(mf."size_bytes")
      FROM "media_files" mf
      WHERE mf."media_id" = p_media_id
    ), 0) + COALESCE((
      SELECT SUM(mf."size_bytes")
      FROM "library_episodes" le
      JOIN "media_files" mf ON mf."episode_id" = le."id"
      WHERE le."media_id" = p_media_id
    ), 0),
    0
  )
  WHERE lm."id" = p_media_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION refresh_library_media_last_grabbed(p_media_id INT) RETURNS void AS $$
BEGIN
  IF p_media_id IS NULL THEN
    RETURN;
  END IF;
  UPDATE "library_media" lm
  SET "last_grabbed_at" = (
    SELECT MAX(dh."grabbed_at")
    FROM "download_history" dh
    WHERE dh."media_id" = p_media_id
  )
  WHERE lm."id" = p_media_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION media_files_resolve_media_id(
  p_media_id INT,
  p_episode_id INT
) RETURNS INT AS $$
DECLARE
  mid INT;
BEGIN
  IF p_media_id IS NOT NULL THEN
    RETURN p_media_id;
  END IF;
  IF p_episode_id IS NOT NULL THEN
    SELECT le."media_id" INTO mid FROM "library_episodes" le WHERE le."id" = p_episode_id;
    RETURN mid;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION media_files_refresh_parent_size() RETURNS trigger AS $$
DECLARE
  mid INT;
  old_mid INT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    mid := media_files_resolve_media_id(OLD."media_id", OLD."episode_id");
    PERFORM refresh_library_media_total_size(mid);
    RETURN OLD;
  END IF;

  mid := media_files_resolve_media_id(NEW."media_id", NEW."episode_id");
  PERFORM refresh_library_media_total_size(mid);

  IF TG_OP = 'UPDATE' THEN
    old_mid := media_files_resolve_media_id(OLD."media_id", OLD."episode_id");
    IF old_mid IS DISTINCT FROM mid THEN
      PERFORM refresh_library_media_total_size(old_mid);
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_media_files_refresh_parent_size ON "media_files";
CREATE TRIGGER trg_media_files_refresh_parent_size
  AFTER INSERT OR UPDATE OF "media_id", "episode_id", "size_bytes" OR DELETE
  ON "media_files"
  FOR EACH ROW
  EXECUTE FUNCTION media_files_refresh_parent_size();

CREATE OR REPLACE FUNCTION download_history_refresh_last_grabbed() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM refresh_library_media_last_grabbed(OLD."media_id");
    RETURN OLD;
  END IF;

  PERFORM refresh_library_media_last_grabbed(NEW."media_id");

  IF TG_OP = 'UPDATE' AND OLD."media_id" IS DISTINCT FROM NEW."media_id" THEN
    PERFORM refresh_library_media_last_grabbed(OLD."media_id");
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_download_history_refresh_last_grabbed ON "download_history";
CREATE TRIGGER trg_download_history_refresh_last_grabbed
  AFTER INSERT OR UPDATE OF "media_id", "grabbed_at" OR DELETE
  ON "download_history"
  FOR EACH ROW
  EXECUTE FUNCTION download_history_refresh_last_grabbed();
