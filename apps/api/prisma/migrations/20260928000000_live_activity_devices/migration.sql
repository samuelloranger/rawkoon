CREATE TABLE "live_activity_devices" (
  "id" SERIAL NOT NULL,
  "user_id" TEXT NOT NULL,
  "installation_id" TEXT NOT NULL,
  "start_token" TEXT NOT NULL,
  "current_job_id" INTEGER,
  "activity_token" TEXT,
  "last_progress" DOUBLE PRECISION,
  "last_step" TEXT,
  "last_sent_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "live_activity_devices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_live_activity_devices_installation" ON "live_activity_devices"("installation_id");
CREATE INDEX "ix_live_activity_devices_user" ON "live_activity_devices"("user_id");
CREATE INDEX "ix_live_activity_devices_job" ON "live_activity_devices"("current_job_id");
ALTER TABLE "live_activity_devices" ADD CONSTRAINT "live_activity_devices_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
