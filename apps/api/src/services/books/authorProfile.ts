/**
 * Author bio/image are shared across every book by that author, so a book
 * refresh fills them only when they are empty and never overwrites a value
 * another book already supplied. First non-empty source wins; a later refresh
 * of any of the author's books leaves a populated field alone.
 */

const nonEmpty = (value: string | null | undefined): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

export interface AuthorProfileCurrent {
  bio: string | null;
  imageUrl: string | null;
}

export interface AuthorProfileIncoming {
  bio?: string | null;
  imageUrl?: string | null;
}

/**
 * The fill-only patch to apply to an Author row: a field appears only when it
 * is currently empty and the incoming value is non-empty. An empty patch means
 * there is nothing to write.
 */
export function authorProfileFill(
  current: AuthorProfileCurrent,
  incoming: AuthorProfileIncoming,
): { bio?: string; imageUrl?: string } {
  const patch: { bio?: string; imageUrl?: string } = {};

  const bio = nonEmpty(incoming.bio);
  if (bio && !nonEmpty(current.bio)) patch.bio = bio;

  const imageUrl = nonEmpty(incoming.imageUrl);
  if (imageUrl && !nonEmpty(current.imageUrl)) patch.imageUrl = imageUrl;

  return patch;
}
