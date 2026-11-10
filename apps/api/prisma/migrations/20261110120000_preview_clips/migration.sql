-- CreateTable
CREATE TABLE "clip_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clip_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preview_clips" (
    "id" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "media_id" INTEGER NOT NULL,
    "season_number" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "start_sec" DOUBLE PRECISION,
    "manual_start" BOOLEAN NOT NULL DEFAULT false,
    "source_media_file_id" INTEGER,
    "source_key" TEXT,
    "bytes" INTEGER,
    "error" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "preview_clips_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_preview_clips_status" ON "preview_clips"("status");

-- CreateIndex
CREATE UNIQUE INDEX "preview_clips_media_id_season_number_key" ON "preview_clips"("media_id", "season_number");

-- AddForeignKey
ALTER TABLE "preview_clips" ADD CONSTRAINT "preview_clips_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "library_media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

