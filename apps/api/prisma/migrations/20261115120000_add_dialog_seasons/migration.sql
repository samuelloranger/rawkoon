-- AlterTable
ALTER TABLE "library_media" ADD COLUMN     "monitor_new_seasons" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "media_requests" ADD COLUMN     "season_mode" TEXT,
ADD COLUMN     "seasons" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];

-- AlterTable
ALTER TABLE "media_settings" ADD COLUMN     "ask_before_adding" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "default_monitor_new_seasons" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "default_season_mode" TEXT NOT NULL DEFAULT 'all',
ADD COLUMN     "requesters_choose_seasons" BOOLEAN NOT NULL DEFAULT true;
