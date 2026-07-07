import { prisma } from "@rawkoon/api/db";
import {
  getQbittorrentIntegrationConfig,
  invalidateQbittorrentIntegrationConfigCache,
} from "@rawkoon/api/services/qbittorrent/config";
import {
  fetchMaindata,
  qbFetchJson,
} from "@rawkoon/api/services/qbittorrent/clientFetch";
import { resetMaindataState } from "@rawkoon/api/services/qbittorrent/clientSession";

type Options = {
  iterations: number;
  delayMs: number;
  mode: "client" | "raw" | "both";
};

type MaindataRaw = {
  rid?: number;
  full_update?: boolean;
  server_state?: Record<string, unknown>;
  torrents?: Record<string, Record<string, unknown>>;
  torrents_removed?: string[];
};

type LogRow = {
  createdAt: Date;
  requestPath: string;
  statusCode: number | null;
  authRetried: boolean;
  rid: number | null;
  fullUpdate: boolean | null;
  itemCount: number | null;
  removedCount: number | null;
  durationMs: number;
  responseBytes: number | null;
  errorMessage: string | null;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const parseArgs = (): Options => {
  const args = process.argv.slice(2);
  const options: Options = {
    iterations: 4,
    delayMs: 1000,
    mode: "both",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === "--iterations" && next) {
      options.iterations = Math.max(
        1,
        Math.min(20, Math.trunc(Number(next) || 4)),
      );
      index += 1;
      continue;
    }

    if (arg === "--delay-ms" && next) {
      options.delayMs = Math.max(
        0,
        Math.min(30_000, Math.trunc(Number(next) || 1000)),
      );
      index += 1;
      continue;
    }

    if (
      arg === "--mode" &&
      next &&
      (next === "client" || next === "raw" || next === "both")
    ) {
      options.mode = next;
      index += 1;
    }
  }

  return options;
};

const formatValue = (value: unknown) => (value == null ? "-" : String(value));

const printRows = (label: string, rows: LogRow[]) => {
  console.log(`\n${label}`);
  if (rows.length === 0) {
    console.log("  no rows");
    return;
  }

  for (const row of rows) {
    console.log(
      [
        row.createdAt.toISOString(),
        row.requestPath,
        `status=${formatValue(row.statusCode)}`,
        `auth=${row.authRetried}`,
        `rid=${formatValue(row.rid)}`,
        `full_update=${formatValue(row.fullUpdate)}`,
        `items=${formatValue(row.itemCount)}`,
        `removed=${formatValue(row.removedCount)}`,
        `duration=${row.durationMs}ms`,
        `bytes=${formatValue(row.responseBytes)}`,
        row.errorMessage ? `error=${row.errorMessage}` : null,
      ]
        .filter(Boolean)
        .join("  "),
    );
  }
};

const fetchRecentLogs = async (since: Date) =>
  prisma.$queryRaw<LogRow[]>`
    SELECT
      "created_at" AS "createdAt",
      "request_path" AS "requestPath",
      "status_code" AS "statusCode",
      "auth_retried" AS "authRetried",
      "rid",
      "full_update" AS "fullUpdate",
      "item_count" AS "itemCount",
      "removed_count" AS "removedCount",
      "duration_ms" AS "durationMs",
      "response_bytes" AS "responseBytes",
      "error_message" AS "errorMessage"
    FROM "qbittorrent_request_logs"
    WHERE "endpoint" = '/api/v2/sync/maindata'
      AND "created_at" >= ${since}
    ORDER BY "created_at" ASC
  `;

const runClientMode = async (
  iterations: number,
  delayMs: number,
  config: NonNullable<
    Awaited<ReturnType<typeof getQbittorrentIntegrationConfig>>["config"]
  >,
) => {
  console.log("\nClient mode: fetchMaindata()");
  resetMaindataState();

  for (let index = 0; index < iterations; index += 1) {
    const snapshot = await fetchMaindata(config);
    console.log(
      JSON.stringify({
        step: index + 1,
        mode: "client",
        torrents: snapshot.torrents.size,
        serverStateKeys: Object.keys(snapshot.serverState).length,
      }),
    );

    if (index < iterations - 1 && delayMs > 0) {
      await sleep(delayMs);
    }
  }
};

const runRawMode = async (
  iterations: number,
  delayMs: number,
  config: NonNullable<
    Awaited<ReturnType<typeof getQbittorrentIntegrationConfig>>["config"]
  >,
) => {
  console.log("\nRaw mode: qbFetchJson(/api/v2/sync/maindata?rid=...)");
  resetMaindataState();
  let rid = 0;

  for (let index = 0; index < iterations; index += 1) {
    const payload = await qbFetchJson<MaindataRaw>(
      config,
      `/api/v2/sync/maindata?rid=${rid}`,
    );
    console.log(
      JSON.stringify({
        step: index + 1,
        mode: "raw",
        reqRid: rid,
        respRid: payload.rid ?? null,
        fullUpdate: payload.full_update ?? null,
        torrents: Object.keys(payload.torrents ?? {}).length,
        removed: (payload.torrents_removed ?? []).length,
        serverStateKeys: Object.keys(payload.server_state ?? {}).length,
      }),
    );

    rid = typeof payload.rid === "number" ? payload.rid : rid;

    if (index < iterations - 1 && delayMs > 0) {
      await sleep(delayMs);
    }
  }
};

const options = parseArgs();
const startedAt = new Date();

await invalidateQbittorrentIntegrationConfigCache();
const { enabled, config } = await getQbittorrentIntegrationConfig();

if (!enabled || !config) {
  console.error("qBittorrent integration is disabled or not configured");
  process.exitCode = 1;
} else {
  console.log(
    JSON.stringify({
      website_url: config.website_url,
      iterations: options.iterations,
      delayMs: options.delayMs,
      mode: options.mode,
    }),
  );

  if (options.mode === "client" || options.mode === "both") {
    await runClientMode(options.iterations, options.delayMs, config);
  }

  if (options.mode === "raw" || options.mode === "both") {
    await runRawMode(options.iterations, options.delayMs, config);
  }

  await sleep(250);
  const rows = await fetchRecentLogs(startedAt);
  printRows("Generated maindata request logs", rows);
}

await prisma.$disconnect();
