/**
 * Create the starter shelves that don't exist yet (matched by `seedKey`), so the
 * TV can be tried before the web editor ships. Never runs at boot.
 *
 * Usage (from the monorepo root):
 *   cd apps/api && bun --env-file=../../.env src/scripts/installStarterShelves.ts
 *   cd apps/api && bun --env-file=../../.env src/scripts/installStarterShelves.ts --keys=christmas,mcu
 *   cd apps/api && bun --env-file=../../.env src/scripts/installStarterShelves.ts --lang=fr
 */

import { prisma } from "@rawkoon/api/db";
import { createShelf } from "@rawkoon/api/services/shelves/shelfService";
import { listSeeds, seedLanguage } from "@rawkoon/api/services/shelves/seeds";
import { getLibraryTmdbApiKey } from "@rawkoon/api/utils/medias/libraryHelpers";

const argValue = (name: string): string | null => {
  const hit = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

async function main() {
  if (!(await getLibraryTmdbApiKey())) {
    console.error("TMDB is not configured; cannot build the starter shelves.");
    process.exitCode = 1;
    return;
  }

  const requested = argValue("keys")
    ?.split(",")
    .map((key) => key.trim())
    .filter(Boolean);
  const language = seedLanguage(argValue("lang"));
  const seeds = listSeeds().filter(
    (seed) => !requested || requested.includes(seed.key),
  );
  const existing = await prisma.shelf.findMany({
    where: { seedKey: { not: null } },
    select: { seedKey: true },
  });
  const installed = new Set(existing.map((shelf) => shelf.seedKey));

  for (const seed of seeds) {
    if (installed.has(seed.key)) {
      console.log(`skip     ${seed.key} (already installed)`);
      continue;
    }
    const created = await createShelf({ seed: seed.key }, language);
    if (!created.ok) {
      console.error(`failed   ${seed.key}: ${created.reason}`);
      process.exitCode = 1;
      continue;
    }
    // createShelf loaded the seed's titles, so the detail read is cheap and offline-safe.
    const count = await prisma.shelfEntry.count({
      where: { shelfId: created.id },
    });
    console.log(`created  ${seed.key} — ${count} titles (shelf ${created.id})`);
  }
}

await main();
await prisma.$disconnect();
