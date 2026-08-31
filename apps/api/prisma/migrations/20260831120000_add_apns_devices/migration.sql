-- CreateTable
CREATE TABLE "apns_devices" (
    "id" SERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "device_token" TEXT NOT NULL,
    "device_name" TEXT,
    "os_version" TEXT,
    "app_version" TEXT,
    "bundle_id" TEXT,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),
    CONSTRAINT "apns_devices_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "ix_apns_devices_user_id" ON "apns_devices"("user_id");
-- CreateIndex
CREATE UNIQUE INDEX "uq_apns_devices_user_token" ON "apns_devices"("user_id", "device_token");
-- AddForeignKey
ALTER TABLE "apns_devices" ADD CONSTRAINT "apns_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
