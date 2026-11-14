/**
 * Verify every MCU timeline id against TMDB: the fetched title and year must
 * still match the curated entry, so a merged or renumbered id fails loudly.
 *
 * Usage (from the monorepo root):
 *   cd apps/api && bun --env-file=../../.env src/scripts/verifyMcuTimeline.ts
 *
 * Uses the library's TMDB key, or `TMDB_API_KEY` when set.
 */

import { prisma } from "@rawkoon/api/db";
import { fetchShelfTitle } from "@rawkoon/api/services/shelves/shelfTmdb";
import mcuTimeline from "@rawkoon/api/services/shelves/timelines/mcu.json";
import { getLibraryTmdbApiKey } from "@rawkoon/api/utils/medias/libraryHelpers";

const CONCURRENCY = 3;

const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** "The Fantastic Four: First Steps" and TMDB's "The Fantastic 4: First Steps" both pass. */
function similar(a: string, b: string): boolean {
  const left = normalize(a);
  const right = normalize(b);
  if (left === right) return true;
  if (left.includes(right) || right.includes(left)) return true;
  const leftTokens = new Set(left.split(" "));
  const rightTokens = new Set(right.split(" "));
  let shared = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) shared++;
  return shared / Math.max(leftTokens.size, rightTokens.size) >= 0.6;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const apiKey = process.env.TMDB_API_KEY || (await getLibraryTmdbApiKey());
  if (!apiKey) {
    console.error(
      "No TMDB key: configure the TMDB integration or set TMDB_API_KEY.",
    );
    process.exitCode = 1;
    return;
  }

  const entries = mcuTimeline.entries;
  const seen = new Set<string>();
  for (const entry of entries) {
    const key = `${entry.type}:${entry.tmdb_id}:${"season" in entry ? entry.season : ""}`;
    if (seen.has(key)) {
      console.error(`duplicate entry: ${key} (${entry.title})`);
      process.exitCode = 1;
    }
    seen.add(key);
  }

  let failures = 0;
  const queue = [...entries];
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const entry = queue.shift();
      if (!entry) return;
      const fetched = await fetchShelfTitle(
        apiKey,
        entry.tmdb_id,
        entry.type === "show" ? "show" : "movie",
      );
      if (!fetched) {
        failures++;
        console.error(
          `MISSING  ${entry.tmdb_id}  ${entry.title} (${entry.year})`,
        );
      } else if (
        fetched.year !== entry.year ||
        !similar(fetched.title, entry.title)
      ) {
        failures++;
        console.error(
          `MISMATCH ${entry.tmdb_id}  curated: ${entry.title} (${entry.year})  TMDB: ${fetched.title} (${fetched.year})`,
        );
      } else if (normalize(fetched.title) !== normalize(entry.title)) {
        console.log(
          `note     ${entry.tmdb_id}  ${entry.title}  TMDB title: ${fetched.title}`,
        );
      }
      await sleep(120);
    }
  });
  await Promise.all(workers);

  console.log(
    `${entries.length - failures}/${entries.length} MCU entries match TMDB.`,
  );
  if (failures > 0) process.exitCode = 1;
}

await main();
await prisma.$disconnect();
