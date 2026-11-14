-- TMDB facts per library title (en-US), for shelf rules. Additive; existing rows
-- keep empty arrays and a null facts_fetched_at until the nightly sweep fills them.
ALTER TABLE "library_media"
  ADD COLUMN "genre_ids" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  ADD COLUMN "keyword_ids" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  ADD COLUMN "company_ids" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  ADD COLUMN "network_ids" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  ADD COLUMN "tmdb_collection_id" INTEGER,
  ADD COLUMN "certification" TEXT,
  ADD COLUMN "vote_count" INTEGER,
  ADD COLUMN "vote_average" DOUBLE PRECISION,
  ADD COLUMN "facts_fetched_at" TIMESTAMP(3);

CREATE INDEX "ix_library_media_genre_ids" ON "library_media" USING GIN ("genre_ids");
CREATE INDEX "ix_library_media_keyword_ids" ON "library_media" USING GIN ("keyword_ids");
CREATE INDEX "ix_library_media_company_ids" ON "library_media" USING GIN ("company_ids");
CREATE INDEX "ix_library_media_network_ids" ON "library_media" USING GIN ("network_ids");
