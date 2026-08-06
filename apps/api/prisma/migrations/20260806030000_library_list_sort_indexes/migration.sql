-- Title search (ILIKE '%…%') on GET /api/library
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS "ix_library_media_title_trgm" ON "library_media" USING GIN ("title" gin_trgm_ops);

-- added_at desc pagination (recently-added rail / default library sort)
CREATE INDEX IF NOT EXISTS "ix_library_media_added_at" ON "library_media"("added_at");

-- Latest-grab / MAX(grabbed_at) per media for last_grabbed_at list sort
CREATE INDEX IF NOT EXISTS "ix_download_history_media_id_grabbed_at" ON "download_history"("media_id", "grabbed_at" DESC);
