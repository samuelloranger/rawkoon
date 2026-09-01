import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

/**
 * SHA-256 of a file on disk, lowercase hex.
 *
 * The digest is the only thing that lets a client tell a good download from a
 * bad one: `book_files.size_bytes` alone accepts a file of the right length and
 * wrong content, which is how a single unreadable chapter can sit in an app's
 * cache indefinitely, preferred over the server copy because it looks complete.
 *
 * Streamed rather than read whole: an audiobook chapter is tens of megabytes and
 * a book is hundreds, and this runs during import alongside ffprobe.
 *
 * Returns null when the file cannot be read. A missing hash means "not checked"
 * to every consumer, so import is never failed over a digest — the file itself
 * has already been validated by the caller.
 */
export const sha256File = async (path: string): Promise<string | null> =>
  new Promise((resolve) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("error", () => resolve(null));
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
