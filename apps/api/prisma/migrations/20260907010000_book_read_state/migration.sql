-- CreateTable
CREATE TABLE "book_read_states" (
    "user_id" TEXT NOT NULL,
    "book_id" INTEGER NOT NULL,
    "read_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "book_read_states_pkey" PRIMARY KEY ("user_id","book_id")
);

-- AddForeignKey
ALTER TABLE "book_read_states" ADD CONSTRAINT "book_read_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_read_states" ADD CONSTRAINT "book_read_states_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "library_books"("id") ON DELETE CASCADE ON UPDATE CASCADE;
