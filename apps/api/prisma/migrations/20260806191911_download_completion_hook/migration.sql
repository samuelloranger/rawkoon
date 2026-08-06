-- AlterTable
ALTER TABLE "media_settings" ADD COLUMN     "download_hook_auto_configure" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "download_hook_callback_url" TEXT,
ADD COLUMN     "download_hook_last_seen_at" TIMESTAMP(3),
ADD COLUMN     "download_hook_token" TEXT,
ADD COLUMN     "download_poll_active_hooked_secs" INTEGER NOT NULL DEFAULT 120;
