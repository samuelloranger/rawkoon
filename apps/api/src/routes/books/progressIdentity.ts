export type BookIdentity = {
  book_id: number;
  title: string;
  authors: string[];
  cover_url: string | null;
};

export function bookIdentityFromEdition(
  edition: {
    book: {
      id: number;
      title: string;
      authors: string[];
      coverUrl: string | null;
    };
  } | null,
): BookIdentity | null {
  if (!edition) return null;
  return {
    book_id: edition.book.id,
    title: edition.book.title,
    authors: edition.book.authors,
    cover_url: edition.book.coverUrl,
  };
}
