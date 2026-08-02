-- AlterTable
ALTER TABLE "library_media" ADD COLUMN     "original_language" TEXT,
ADD COLUMN     "original_title" TEXT,
ADD COLUMN     "search_title" TEXT,
ADD COLUMN     "search_title_language" TEXT;

-- AlterTable
ALTER TABLE "quality_profiles" ADD COLUMN     "preferred_search_language" TEXT;
