-- AlterTable
ALTER TABLE "book_editions" ADD COLUMN     "offline_ready" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "book_files" ADD COLUMN     "chapter_index" INTEGER,
ADD COLUMN     "sha256" TEXT;

-- CreateTable
CREATE TABLE "book_chapters" (
    "id" SERIAL NOT NULL,
    "edition_id" INTEGER NOT NULL,
    "book_file_id" INTEGER NOT NULL,
    "index" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "start_secs" DOUBLE PRECISION NOT NULL,
    "end_secs" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "book_chapters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "book_listening_progress" (
    "id" SERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "edition_id" INTEGER NOT NULL,
    "position_secs" DOUBLE PRECISION NOT NULL,
    "total_duration_secs" DOUBLE PRECISION NOT NULL,
    "finished" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "device_id" TEXT,

    CONSTRAINT "book_listening_progress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_book_chapters_edition_index" ON "book_chapters"("edition_id", "index");

-- CreateIndex
CREATE UNIQUE INDEX "uq_book_progress_user_edition" ON "book_listening_progress"("user_id", "edition_id");

-- AddForeignKey
ALTER TABLE "book_chapters" ADD CONSTRAINT "book_chapters_edition_id_fkey" FOREIGN KEY ("edition_id") REFERENCES "book_editions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_chapters" ADD CONSTRAINT "book_chapters_book_file_id_fkey" FOREIGN KEY ("book_file_id") REFERENCES "book_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_listening_progress" ADD CONSTRAINT "book_listening_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_listening_progress" ADD CONSTRAINT "book_listening_progress_edition_id_fkey" FOREIGN KEY ("edition_id") REFERENCES "book_editions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
