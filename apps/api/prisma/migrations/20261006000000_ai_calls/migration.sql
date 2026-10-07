CREATE TABLE "ai_calls" (
  "id" SERIAL NOT NULL,
  "feature" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "structured" BOOLEAN NOT NULL,
  "status" TEXT NOT NULL,
  "trigger" TEXT,
  "error" TEXT,
  "input_tokens" INTEGER,
  "output_tokens" INTEGER,
  "total_tokens" INTEGER,
  "duration_ms" INTEGER NOT NULL,
  "media_id" INTEGER,
  "book_edition_id" INTEGER,
  "picked_title" TEXT,
  "reasoning" TEXT,
  "classic_title" TEXT,
  "agreed_with_classic" BOOLEAN,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_calls_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ix_ai_calls_created_at" ON "ai_calls"("created_at");
CREATE INDEX "ix_ai_calls_feature_created_at" ON "ai_calls"("feature", "created_at");
