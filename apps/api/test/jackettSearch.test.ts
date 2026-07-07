/**
 * Integration test: real Jackett HTTP calls for the French accented-title query.
 *
 * Requires DATABASE_URL and a configured, enabled Jackett integration in the DB.
 * Run with: cd apps/api && bun test test/jackettSearch.test.ts
 */
import { beforeAll, describe, expect, it } from "bun:test";
import { prisma } from "../src/db";
import { normalizeJackettConfig } from "../src/utils/integrations/normalizers";
import { JackettAdapter } from "../src/services/indexerManager/jackettAdapter";

const hasDb = !!process.env.DATABASE_URL;

// The query as the user types it in the search box (raw, accented, with colon).
const RAW_QUERY = "Jérémie: rendez-vous à la plage";

// What the API now sends to Jackett after the fix: NFD-stripped, colon removed.
const NORMALIZED_QUERY = "Jeremie rendez-vous a la plage";

describe("Jackett search — French accented title fix", () => {
  let adapter: JackettAdapter | null = null;

  beforeAll(async () => {
    if (!hasDb) return;
    const integration = await prisma.integration.findFirst({
      where: { type: "jackett" },
      select: { enabled: true, config: true },
    });
    if (!integration?.enabled) return;
    const config = normalizeJackettConfig(integration.config);
    if (!config) return;
    adapter = new JackettAdapter(config);
  });

  it("normalized query returns at least one result (the user says results exist)", async () => {
    if (!adapter) {
      console.log("SKIP — Jackett not configured or DB unavailable");
      return;
    }

    const results = await adapter.search({
      query: NORMALIZED_QUERY,
      type: "freetext",
    });

    console.log(
      `\n[normalized] "${NORMALIZED_QUERY}" → ${results.length} result(s)`,
    );
    for (const r of results.slice(0, 10)) {
      console.log(`  ${r.seeders ?? "?"} seeds  ${r.title}  [${r.indexer}]`);
    }

    expect(results.length).toBeGreaterThan(0);
  }, 30_000);

  it("raw accented+colon query returns fewer or equal results vs normalized", async () => {
    if (!adapter) {
      console.log("SKIP — Jackett not configured or DB unavailable");
      return;
    }

    const [rawResults, normalizedResults] = await Promise.all([
      adapter.search({ query: RAW_QUERY, type: "freetext" }),
      adapter.search({ query: NORMALIZED_QUERY, type: "freetext" }),
    ]);

    console.log(
      `\n[raw]        "${RAW_QUERY}" → ${rawResults.length} result(s)`,
    );
    for (const r of rawResults.slice(0, 5)) {
      console.log(`  ${r.seeders ?? "?"} seeds  ${r.title}  [${r.indexer}]`);
    }

    console.log(
      `\n[normalized] "${NORMALIZED_QUERY}" → ${normalizedResults.length} result(s)`,
    );
    for (const r of normalizedResults.slice(0, 5)) {
      console.log(`  ${r.seeders ?? "?"} seeds  ${r.title}  [${r.indexer}]`);
    }

    // The normalized query should never return FEWER results than the raw one.
    // If raw == 0 and normalized > 0, the colon/accent was definitely the culprit.
    expect(normalizedResults.length).toBeGreaterThanOrEqual(rawResults.length);
  }, 30_000);
});
