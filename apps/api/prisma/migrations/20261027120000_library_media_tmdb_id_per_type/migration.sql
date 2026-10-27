-- TMDB movie and TV ids are separate id spaces, so a movie and a show can share one.
--
-- Databases built by the pre-rename migration chain may carry the tmdb_id-only
-- unique key under another name, or as a constraint rather than a bare index,
-- so drop whatever enforces it instead of assuming 0_init's index name. A
-- failure here blocks container startup, since entrypoint.sh runs migrate
-- deploy on every boot.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = '"library_media"'::regclass
      AND c.contype = 'u'
      AND c.conkey = ARRAY[(
        SELECT a.attnum FROM pg_attribute a
        WHERE a.attrelid = '"library_media"'::regclass AND a.attname = 'tmdb_id'
      )]
  LOOP
    EXECUTE format('ALTER TABLE "library_media" DROP CONSTRAINT %I', r.conname);
  END LOOP;

  FOR r IN
    SELECT ic.relname
    FROM pg_index i
    JOIN pg_class ic ON ic.oid = i.indexrelid
    WHERE i.indrelid = '"library_media"'::regclass
      AND i.indisunique
      AND i.indnatts = 1
      AND i.indkey[0] = (
        SELECT a.attnum FROM pg_attribute a
        WHERE a.attrelid = '"library_media"'::regclass AND a.attname = 'tmdb_id'
      )
  LOOP
    EXECUTE format('DROP INDEX %I', r.relname);
  END LOOP;
END $$;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "uq_library_media_tmdb_id_type" ON "library_media"("tmdb_id", "type");
