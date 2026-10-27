-- TMDB movie and TV ids are separate id spaces, so a movie and a show can share one.
DROP INDEX "library_media_tmdb_id_key";

-- CreateIndex
CREATE UNIQUE INDEX "uq_library_media_tmdb_id_type" ON "library_media"("tmdb_id", "type");
