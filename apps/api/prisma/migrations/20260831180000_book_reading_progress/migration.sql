-- CreateTable
CREATE TABLE "book_reading_progress" (
    "id" SERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "edition_id" INTEGER NOT NULL,
    "file_id" INTEGER,
    "spine_index" INTEGER NOT NULL,
    "spine_path" TEXT NOT NULL,
    "spine_count" INTEGER NOT NULL,
    "scroll_fraction" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "finished" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "device_id" TEXT,

    CONSTRAINT "book_reading_progress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_book_reading_progress_user_edition" ON "book_reading_progress"("user_id", "edition_id");

-- AddForeignKey
ALTER TABLE "book_reading_progress" ADD CONSTRAINT "book_reading_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_reading_progress" ADD CONSTRAINT "book_reading_progress_edition_id_fkey" FOREIGN KEY ("edition_id") REFERENCES "book_editions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

