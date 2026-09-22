-- Seed release is ratio-only: clear any seed-time targets and stop defaulting one.
ALTER TABLE "media_settings" ALTER COLUMN "private_seed_time_mins" DROP DEFAULT;
UPDATE "media_settings" SET "public_seed_time_mins" = NULL, "private_seed_time_mins" = NULL;
UPDATE "indexer_seed_rule" SET "seed_time_mins" = NULL;
