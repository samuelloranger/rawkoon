CREATE TABLE "book_listening_daily" (
    "user_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "seconds" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "book_listening_daily_pkey" PRIMARY KEY ("user_id","day")
);

ALTER TABLE "book_listening_daily" ADD CONSTRAINT "book_listening_daily_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
