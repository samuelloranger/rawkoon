-- AlterTable
ALTER TABLE "library_episodes" ADD COLUMN     "last_miss_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "library_media" ADD COLUMN     "last_miss_at" TIMESTAMP(3);
