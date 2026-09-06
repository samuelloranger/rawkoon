-- Additive support for non-admin book requests: media_requests grows nullable
-- book-identity columns alongside the existing tmdb-based ones, and tmdb_id
-- becomes nullable since book requests have none.

-- AlterTable
ALTER TABLE "media_requests" ADD COLUMN     "author" TEXT,
ADD COLUMN     "book_quality_profile_id" INTEGER,
ADD COLUMN     "google_volume_id" TEXT,
ADD COLUMN     "library_book_id" INTEGER,
ALTER COLUMN "tmdb_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "ix_media_request_library_book_id" ON "media_requests"("library_book_id");

-- CreateIndex
CREATE INDEX "ix_media_request_book_quality_profile_id" ON "media_requests"("book_quality_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_media_request_google_volume_id" ON "media_requests"("google_volume_id");

-- AddForeignKey
ALTER TABLE "media_requests" ADD CONSTRAINT "media_requests_book_quality_profile_id_fkey" FOREIGN KEY ("book_quality_profile_id") REFERENCES "book_quality_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_requests" ADD CONSTRAINT "media_requests_library_book_id_fkey" FOREIGN KEY ("library_book_id") REFERENCES "library_books"("id") ON DELETE SET NULL ON UPDATE CASCADE;
