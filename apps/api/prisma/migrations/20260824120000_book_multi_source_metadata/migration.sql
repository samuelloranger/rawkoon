-- AlterTable
ALTER TABLE "authors" ADD COLUMN     "audible_asin" TEXT;

-- AlterTable
ALTER TABLE "library_books" ADD COLUMN     "genres" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "narrators" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "page_count" INTEGER,
ADD COLUMN     "published_date" TIMESTAMP(3),
ADD COLUMN     "publisher" TEXT,
ADD COLUMN     "rating" DOUBLE PRECISION,
ADD COLUMN     "rating_count" INTEGER;

-- AlterTable
ALTER TABLE "media_settings" ADD COLUMN     "book_metadata_source_order" TEXT[] DEFAULT ARRAY['local', 'audnexus', 'googlebooks', 'openlibrary']::TEXT[];

-- CreateTable
CREATE TABLE "book_external_ids" (
    "id" SERIAL NOT NULL,
    "book_id" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "book_external_ids_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "book_metadata_fields" (
    "id" SERIAL NOT NULL,
    "book_id" INTEGER NOT NULL,
    "field" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "book_metadata_fields_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_book_external_ids_source_external" ON "book_external_ids"("source", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_book_external_ids_book_source" ON "book_external_ids"("book_id", "source");

-- CreateIndex
CREATE INDEX "ix_book_metadata_fields_book_id" ON "book_metadata_fields"("book_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_book_metadata_fields_book_field" ON "book_metadata_fields"("book_id", "field");

-- CreateIndex
CREATE UNIQUE INDEX "authors_audible_asin_key" ON "authors"("audible_asin");

-- AddForeignKey
ALTER TABLE "book_external_ids" ADD CONSTRAINT "book_external_ids_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "library_books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_metadata_fields" ADD CONSTRAINT "book_metadata_fields_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "library_books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

