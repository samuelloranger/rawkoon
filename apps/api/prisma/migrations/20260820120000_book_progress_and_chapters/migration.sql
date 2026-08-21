-- CreateTable
CREATE TABLE "book_file_chapters" (
    "id" SERIAL NOT NULL,
    "file_id" INTEGER NOT NULL,
    "index" INTEGER NOT NULL,
    "title" TEXT,
    "start_secs" DOUBLE PRECISION NOT NULL,
    "end_secs" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "book_file_chapters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "book_progress" (
    "id" SERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "edition_id" INTEGER NOT NULL,
    "locator" TEXT,
    "percent" DOUBLE PRECISION,
    "position_secs" DOUBLE PRECISION,
    "file_id" INTEGER,
    "finished_at" TIMESTAMP(3),
    "client_updated_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "book_progress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_book_file_chapters_file_index" ON "book_file_chapters"("file_id", "index");

-- CreateIndex
CREATE INDEX "ix_book_progress_edition_id" ON "book_progress"("edition_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_book_progress_user_edition" ON "book_progress"("user_id", "edition_id");

-- AddForeignKey
ALTER TABLE "book_file_chapters" ADD CONSTRAINT "book_file_chapters_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "book_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_progress" ADD CONSTRAINT "book_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_progress" ADD CONSTRAINT "book_progress_edition_id_fkey" FOREIGN KEY ("edition_id") REFERENCES "book_editions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

