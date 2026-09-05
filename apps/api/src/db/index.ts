import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { loadConfig } from "@rawkoon/api/config";
import {
  PERF_TIMING_ENABLED,
  recordDbQuery,
} from "@rawkoon/api/services/perf/perfStore";

const adapter = new PrismaPg({ connectionString: loadConfig().DATABASE_URL });

// When the perf baseline is being captured (PERF_TIMING_ENABLED=true) emit query
// events and accumulate count + duration into the in-memory perf store. Off by
// default: a normal run constructs the client exactly as before, with no query
// event subscription and no per-query overhead.
export const prisma = PERF_TIMING_ENABLED
  ? (() => {
      const client = new PrismaClient({
        adapter,
        log: [{ emit: "event", level: "query" }],
      });
      client.$on("query", (e) => {
        recordDbQuery(e.duration);
      });
      return client;
    })()
  : new PrismaClient({ adapter });
