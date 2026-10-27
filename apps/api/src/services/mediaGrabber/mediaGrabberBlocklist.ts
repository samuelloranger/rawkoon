import { prisma } from "@rawkoon/api/db";
import type { CandidateRow } from "@rawkoon/api/services/mediaGrabber/mediaGrabberHelpers";

/**
 * Pre-filter blocklisted titles so we don't waste the grab attempt on them.
 * Scope the query to the candidate titles actually being checked rather
 * than loading the entire blocklist into memory on every search. Match
 * case-insensitively (Postgres `in` is case-sensitive) so an entry that
 * differs only by casing still suppresses the release.
 * Hash-based blocklist is a secondary check inside grabRelease itself.
 */
export async function dropBlocklistedTitles(
  rows: CandidateRow[],
): Promise<CandidateRow[]> {
  const candidateTitles = rows.map((r) => r.title);
  const blocklistTitles = await prisma.grabBlocklist
    .findMany({
      where: {
        OR: candidateTitles.map((title) => ({
          releaseTitle: { equals: title, mode: "insensitive" as const },
        })),
      },
      select: { releaseTitle: true },
    })
    .then((found) => new Set(found.map((r) => r.releaseTitle.toLowerCase())));

  return rows.filter(
    (r) => !blocklistTitles.has(r.title.toLowerCase()) && r.raw._downloadUrl,
  );
}
