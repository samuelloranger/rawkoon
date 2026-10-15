-- CreateTable
CREATE TABLE "ba_device_codes" (
    "id" TEXT NOT NULL,
    "device_code" TEXT NOT NULL,
    "user_code" TEXT NOT NULL,
    "user_id" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "last_polled_at" TIMESTAMP(3),
    "polling_interval" INTEGER,
    "client_id" TEXT,
    "scope" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ba_device_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_ba_device_codes_device_code" ON "ba_device_codes"("device_code");

-- CreateIndex
CREATE INDEX "ix_ba_device_codes_user_code" ON "ba_device_codes"("user_code");
