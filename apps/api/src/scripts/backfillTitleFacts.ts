/**
 * Fill TMDB facts (genres, keywords, companies, rating) for library titles that
 * have none yet, so shelf rules can match them. The nightly sweep does the same
 * a slice at a time; this drains the backlog in one go. Safe to re-run.
 *
 * Usage (from the monorepo root):
 *   cd apps/api && bun --env-file=../../.env src/scripts/backfillTitleFacts.ts
 *   cd apps/api && bun --env-file=../../.env src/scripts/backfillTitleFacts.ts --limit=20
 *   cd apps/api && bun --env-file=../../.env src/scripts/backfillTitleFacts.ts --auto-join
 */

import { prisma } from "@rawkoon/api/db";
import { runTitleFactsSweep } from "@rawkoon/api/services/shelves/titleFactsSweep";

const argValue = (name: string): string | null => {
  const hit = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

async function main() {
  const limit = Number(argValue("limit") ?? 100_000);
  const result = await runTitleFactsSweep({
    maxTitles: Number.isFinite(limit) && limit > 0 ? limit : 100_000,
    // Refreshing old votes is the nightly job's business
    autoJoin: process.argv.includes("--auto-join"),
  });
  console.log(
    `filled ${result.filled}, refreshed ${result.refreshed}, failed ${result.failed}` +
      (result.rateLimited ? " (stopped: TMDB rate limit)" : ""),
  );
  if (result.joined) {
    console.log(
      `auto-join: ${result.joined.added} added across ${result.joined.shelves} shelves`,
    );
  }
  if (result.rateLimited || result.failed) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
