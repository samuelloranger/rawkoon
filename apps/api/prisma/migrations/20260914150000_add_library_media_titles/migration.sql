-- CreateTable
CREATE TABLE "library_media_titles" (
    "media_id" INTEGER NOT NULL,
    "language" VARCHAR(8) NOT NULL,
    "title" TEXT NOT NULL,
    "sort_title" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "library_media_titles_pkey" PRIMARY KEY ("media_id","language")
);

-- CreateIndex
CREATE INDEX "ix_library_media_titles_language_sort_title" ON "library_media_titles"("language", "sort_title");

-- CreateIndex
CREATE INDEX "ix_library_media_titles_title_trgm" ON "library_media_titles" USING GIN ("title" gin_trgm_ops);

-- AddForeignKey
ALTER TABLE "library_media_titles" ADD CONSTRAINT "library_media_titles_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "library_media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

