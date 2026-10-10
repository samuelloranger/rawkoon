ALTER TABLE "users" ADD COLUMN "calendar_token" TEXT;

CREATE UNIQUE INDEX "ix_users_calendar_token" ON "users"("calendar_token");
