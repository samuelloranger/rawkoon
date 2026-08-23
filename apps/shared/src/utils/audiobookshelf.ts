/**
 * Deep links into an Audiobookshelf instance.
 *
 * Rawkoon never calls the Audiobookshelf API — it has no key and stores no ABS
 * item ids — so the only handle it has on a title is a search. The route shape
 * (`/library/:library/search?q=`) is Audiobookshelf's own client route, not an
 * API endpoint.
 */

/**
 * Build a search URL into one Audiobookshelf library.
 *
 * Returns null whenever the link cannot be built — unconfigured instance,
 * missing library id, empty title, or a base URL that is not http(s). Callers
 * render the button only for a non-null result, so an install without
 * Audiobookshelf silently shows nothing rather than a dead link.
 */
export const audiobookshelfSearchUrl = (
  baseUrl: string | null | undefined,
  libraryId: string | null | undefined,
  title: string,
): string | null => {
  const base = baseUrl?.trim();
  const library = libraryId?.trim();
  const query = title.trim();
  if (!base || !library || !query) return null;

  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    return null;
  }
  // A stored value is operator input; anything but http(s) would turn the
  // button into a script or file link.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  const origin = base.replace(/\/+$/, "");
  return `${origin}/library/${encodeURIComponent(library)}/search?q=${encodeURIComponent(query)}`;
};
