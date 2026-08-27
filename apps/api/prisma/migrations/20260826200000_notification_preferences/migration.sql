-- User-level notification type preferences (opt-out toggles).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "notification_preferences" JSONB;
