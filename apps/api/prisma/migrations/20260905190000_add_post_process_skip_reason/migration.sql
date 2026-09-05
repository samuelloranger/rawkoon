-- A losing duplicate grab can post-process "successfully" while importing
-- nothing: the pre-scan finds the winning grab's file already on disk and
-- short-circuits. Record that skip in its own column so it is never confused
-- with a real failure (post_process_error, which drives failure notices) and
-- so the "downloaded" notification can be suppressed for a duplicate.
ALTER TABLE "download_history" ADD COLUMN "post_process_skip_reason" TEXT;
