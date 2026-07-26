ALTER TABLE "media_settings"
  ADD COLUMN "download_poll_active_secs" INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN "download_poll_idle_secs" INTEGER NOT NULL DEFAULT 1800,
  ADD COLUMN "download_stall_timeout_secs" INTEGER NOT NULL DEFAULT 2700,
  ADD COLUMN "download_max_age_secs" INTEGER NOT NULL DEFAULT 604800;
