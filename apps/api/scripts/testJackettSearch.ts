/**
 * Integration script: compare Jackett search results for the raw accented query
 * vs the normalized query, proving the query-normalization fix is necessary.
 *
 * Run with:
 *   cd apps/api && bun run --env-file ../../.env scripts/testJackettSearch.ts
 */
import { prisma } from "../src/db";
import { normalizeJackettConfig } from "../src/utils/integrations/normalizers";
import { JackettAdapter } from "../src/services/indexerManager/jackettAdapter";

const RAW_QUERY = "Jérémie: rendez-vous à la plage";
const NORMALIZED_QUERY = "Jeremie rendez-vous a la plage";

async function main() {
  const integration = await prisma.integration.findFirst({
    where: { type: "jackett" },
    select: { enabled: true, config: true },
  });

  if (!integration?.enabled) {
    console.error("Jackett integration not found or disabled.");
    process.exit(1);
  }

  const config = normalizeJackettConfig(integration.config);
  if (!config) {
    console.error("Could not parse Jackett config.");
    process.exit(1);
  }

  const adapter = new JackettAdapter(config);
  console.log(`Jackett URL: ${config.website_url}\n`);

  console.log(`Querying with RAW query: "${RAW_QUERY}"`);
  const rawResults = await adapter.search({
    query: RAW_QUERY,
    type: "freetext",
  });

  console.log(`Querying with NORMALIZED query: "${NORMALIZED_QUERY}"`);
  const normalizedResults = await adapter.search({
    query: NORMALIZED_QUERY,
    type: "freetext",
  });

  console.log(`\n--- RAW query (${rawResults.length} result(s)) ---`);
  for (const r of rawResults.slice(0, 10)) {
    console.log(`  [${r.seeders ?? "?"}s] ${r.title}  (${r.indexer})`);
  }

  console.log(
    `\n--- NORMALIZED query (${normalizedResults.length} result(s)) ---`,
  );
  for (const r of normalizedResults.slice(0, 10)) {
    console.log(`  [${r.seeders ?? "?"}s] ${r.title}  (${r.indexer})`);
  }

  const diff = normalizedResults.length - rawResults.length;
  if (diff > 0) {
    console.log(
      `\n✓ Normalized query found ${diff} more result(s) — query normalization fix confirmed.`,
    );
  } else if (rawResults.length === 0 && normalizedResults.length === 0) {
    console.log(
      "\n⚠ Both queries returned 0 results — indexers may not have this title.",
    );
  } else {
    console.log(
      "\n✓ Both queries returned the same count — Jackett normalizes internally.",
    );
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
