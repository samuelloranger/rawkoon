CREATE TABLE "transcode_jobs" (
  "id" SERIAL PRIMARY KEY,
  "media_file_id" INTEGER REFERENCES "media_files"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "media_id" INTEGER REFERENCES "library_media"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "batch_id" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "position" DOUBLE PRECISION NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "step" TEXT,
  "settings" JSONB NOT NULL,
  "source_bytes" BIGINT NOT NULL,
  "estimated_bytes" BIGINT,
  "output_bytes" BIGINT,
  "source_nlink" INTEGER,
  "progress" DOUBLE PRECISION,
  "ssim_avg" DOUBLE PRECISION,
  "ssim_min" DOUBLE PRECISION,
  "error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMP(3),
  "finished_at" TIMESTAMP(3)
);

CREATE INDEX "ix_transcode_jobs_status_position" ON "transcode_jobs"("status", "position");
CREATE INDEX "ix_transcode_jobs_batch_id" ON "transcode_jobs"("batch_id");
-- One active job per file; history rows are unconstrained.
CREATE UNIQUE INDEX "ux_transcode_jobs_active_file" ON "transcode_jobs"("media_file_id")
  WHERE "status" IN ('queued', 'running');

CREATE TABLE "transcode_settings" (
  "id" INTEGER PRIMARY KEY DEFAULT 1,
  "paused" BOOLEAN NOT NULL DEFAULT false,
  "window_enabled" BOOLEAN NOT NULL DEFAULT false,
  "window_start" TEXT NOT NULL DEFAULT '01:00',
  "window_end" TEXT NOT NULL DEFAULT '08:00',
  "ssim_threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.97,
  "ssim_clip_min" DOUBLE PRECISION NOT NULL DEFAULT 0.95,
  "cpu_threads" INTEGER,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
