-- AlterTable
ALTER TABLE "users" ADD COLUMN "jellyfin_user_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ix_users_jellyfin_user_id" ON "users"("jellyfin_user_id");
