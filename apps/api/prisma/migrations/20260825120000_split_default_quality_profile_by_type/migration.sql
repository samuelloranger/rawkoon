-- Movies and TV shows want different quality by default (issue #25), so the
-- single shared default splits in two. The existing column is renamed rather
-- than dropped and recreated, which carries its foreign key across untouched.
ALTER TABLE "media_settings" RENAME COLUMN "default_quality_profile_id" TO "default_movie_quality_profile_id";
ALTER TABLE "media_settings" RENAME CONSTRAINT "media_settings_default_quality_profile_id_fkey" TO "media_settings_default_movie_quality_profile_id_fkey";

ALTER TABLE "media_settings" ADD COLUMN "default_show_quality_profile_id" INTEGER;

-- Seed the show default from the movie default so an upgraded install keeps
-- assigning exactly the profile it assigned before, to both types, until an
-- administrator deliberately changes one of them.
UPDATE "media_settings" SET "default_show_quality_profile_id" = "default_movie_quality_profile_id";

ALTER TABLE "media_settings" ADD CONSTRAINT "media_settings_default_show_quality_profile_id_fkey" FOREIGN KEY ("default_show_quality_profile_id") REFERENCES "quality_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
