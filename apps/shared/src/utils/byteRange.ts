/**
 * HTTP Range parsing, shared by the byte route and the service worker.
 *
 * Both have to agree: WebKit will not play media from a service worker that
 * answers a `Range` request with a whole `200`, so the worker synthesises the
 * same `206` the origin would have sent. Two implementations of this would
 * drift, and the drift would only show up as an audiobook that refuses to play
 * offline on one browser.
 */

export interface ParsedByteRange {
  start: number;
  end: number;
}

/**
 * Parse a single-range `Range` header against a known size.
 *
 * Returns `null` when there is nothing to honour (no header, a syntax the
 * client should not have sent, or a multi-range request, which is answered in
 * full), `"unsatisfiable"` when the range cannot be served — the caller owes a
 * 416 with a `Content-Range` naming the real size, which is what lets a media
 * element recover instead of erroring out.
 */
export const parseByteRange = (
  header: string | null | undefined,
  size: number,
): ParsedByteRange | null | "unsatisfiable" => {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return null;

  // An empty resource can satisfy no range at all, suffix or otherwise.
  if (size <= 0) return "unsatisfiable";

  if (rawStart === "") {
    // Suffix form: the last N bytes.
    const suffix = Number(rawEnd);
    if (suffix <= 0) return "unsatisfiable";
    const start = Math.max(0, size - suffix);
    return { start, end: size - 1 };
  }

  const start = Number(rawStart);
  if (start >= size) return "unsatisfiable";
  const end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (end < start) return "unsatisfiable";
  return { start, end };
};
