import { mock } from "bun:test";
import * as realDns from "node:dns/promises";

const realLookup = realDns.lookup;
export const fakeDns = new Map<string, string[]>();

// Unmapped hosts fall through to the real resolver so other suites are unaffected.
mock.module("node:dns/promises", () => ({
  ...realDns,
  lookup: async (host: string, opts?: unknown) => {
    const ips = fakeDns.get(host);
    if (!ips) return (realLookup as (...a: unknown[]) => unknown)(host, opts);
    return ips.map((address) => ({
      address,
      family: address.includes(":") ? 6 : 4,
    }));
  },
}));
