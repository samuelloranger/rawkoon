import { mock } from "bun:test";
import * as realDns from "node:dns/promises";

const realLookup = realDns.lookup;
/** Host → addresses, or an Error to make the lookup fail. Clear it in afterAll. */
export const fakeDns = new Map<string, string[] | Error>();

// Unmapped hosts fall through to the real resolver so other suites are unaffected.
mock.module("node:dns/promises", () => ({
  ...realDns,
  lookup: async (host: string, opts?: unknown) => {
    const entry = fakeDns.get(host);
    if (!entry) return (realLookup as (...a: unknown[]) => unknown)(host, opts);
    if (entry instanceof Error) throw entry;
    const answers = entry.map((address) => ({
      address,
      family: address.includes(":") ? 6 : 4,
    }));
    const all = (opts as { all?: boolean } | undefined)?.all === true;
    return all ? answers : answers[0];
  },
}));
