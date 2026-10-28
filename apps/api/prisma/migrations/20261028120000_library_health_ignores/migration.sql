CREATE TABLE "library_health_ignores" (
  "id" SERIAL NOT NULL,
  "issue_key" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "title" TEXT,
  "detail" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "library_health_ignores_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_library_health_ignores_issue_key" ON "library_health_ignores"("issue_key");
