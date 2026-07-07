import { Prisma } from "@prisma/client";
import { prisma } from "@rawkoon/api/db";

type Options = {
  minutes: number;
  limit: number;
  endpoint?: string;
  errorsOnly: boolean;
};

type QbittorrentRequestLogRow = {
  id: number;
  method: string;
  endpoint: string;
  requestPath: string;
  statusCode: number | null;
  ok: boolean;
  durationMs: number;
  responseBytes: number | null;
  authRetried: boolean;
  rid: number | null;
  fullUpdate: boolean | null;
  itemCount: number | null;
  removedCount: number | null;
  errorMessage: string | null;
  createdAt: Date;
};

const parseArgs = (): Options => {
  const args = process.argv.slice(2);
  const options: Options = {
    minutes: 15,
    limit: 200,
    errorsOnly: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === "--minutes" && next) {
      options.minutes = Math.max(1, Math.trunc(Number(next) || 15));
      index += 1;
      continue;
    }

    if (arg === "--limit" && next) {
      options.limit = Math.max(
        1,
        Math.min(5000, Math.trunc(Number(next) || 200)),
      );
      index += 1;
      continue;
    }

    if (arg === "--endpoint" && next) {
      options.endpoint = next;
      index += 1;
      continue;
    }

    if (arg === "--errors") {
      options.errorsOnly = true;
    }
  }

  return options;
};

const formatNumber = (value: number) => value.toLocaleString("en-US");

const percentile = (values: number[], p: number) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[index] ?? 0;
};

const options = parseArgs();
const since = new Date(Date.now() - options.minutes * 60_000);
const filters: Prisma.Sql[] = [Prisma.sql`"created_at" >= ${since}`];

if (options.endpoint) {
  filters.push(Prisma.sql`"endpoint" = ${options.endpoint}`);
}

if (options.errorsOnly) {
  filters.push(Prisma.sql`"ok" = false`);
}

const rows = await prisma.$queryRaw<QbittorrentRequestLogRow[]>(Prisma.sql`
  SELECT
    "id",
    "method",
    "endpoint",
    "request_path" AS "requestPath",
    "status_code" AS "statusCode",
    "ok",
    "duration_ms" AS "durationMs",
    "response_bytes" AS "responseBytes",
    "auth_retried" AS "authRetried",
    "rid",
    "full_update" AS "fullUpdate",
    "item_count" AS "itemCount",
    "removed_count" AS "removedCount",
    "error_message" AS "errorMessage",
    "created_at" AS "createdAt"
  FROM "qbittorrent_request_logs"
  WHERE ${Prisma.join(filters, " AND ")}
  ORDER BY "created_at" DESC
  LIMIT ${options.limit}
`);

const byEndpoint = new Map<
  string,
  {
    count: number;
    errors: number;
    durations: number[];
    bytes: number;
    fullUpdates: number;
    items: number[];
  }
>();

for (const row of rows) {
  const entry = byEndpoint.get(row.endpoint) ?? {
    count: 0,
    errors: 0,
    durations: [],
    bytes: 0,
    fullUpdates: 0,
    items: [],
  };

  entry.count += 1;
  entry.errors += row.ok ? 0 : 1;
  entry.durations.push(row.durationMs);
  entry.bytes += row.responseBytes ?? 0;
  entry.fullUpdates += row.fullUpdate ? 1 : 0;
  if (typeof row.itemCount === "number") entry.items.push(row.itemCount);

  byEndpoint.set(row.endpoint, entry);
}

console.log(
  `qBittorrent request logs since ${since.toISOString()} (${rows.length} rows)\n`,
);

for (const [endpoint, entry] of [...byEndpoint.entries()].sort(
  (a, b) => b[1].count - a[1].count,
)) {
  const avgMs = entry.durations.length
    ? Math.round(
        entry.durations.reduce((sum, value) => sum + value, 0) /
          entry.durations.length,
      )
    : 0;
  const avgItems = entry.items.length
    ? Math.round(
        entry.items.reduce((sum, value) => sum + value, 0) / entry.items.length,
      )
    : 0;

  console.log(
    [
      endpoint,
      `count=${formatNumber(entry.count)}`,
      `errors=${formatNumber(entry.errors)}`,
      `avg=${formatNumber(avgMs)}ms`,
      `p95=${formatNumber(percentile(entry.durations, 95))}ms`,
      `bytes=${formatNumber(entry.bytes)}`,
      `fullUpdates=${formatNumber(entry.fullUpdates)}`,
      `avgItems=${formatNumber(avgItems)}`,
    ].join("  "),
  );
}

if (rows.length > 0) {
  console.log("\nLatest rows:\n");
  for (const row of rows.slice(0, 20)) {
    console.log(
      [
        row.createdAt.toISOString(),
        row.method,
        row.endpoint,
        `status=${row.statusCode ?? "ERR"}`,
        `ok=${row.ok}`,
        `duration=${row.durationMs}ms`,
        `bytes=${row.responseBytes ?? 0}`,
        row.rid != null ? `rid=${row.rid}` : null,
        row.fullUpdate != null ? `full_update=${row.fullUpdate}` : null,
        row.itemCount != null ? `items=${row.itemCount}` : null,
        row.removedCount != null ? `removed=${row.removedCount}` : null,
        row.errorMessage ? `error=${row.errorMessage}` : null,
      ]
        .filter(Boolean)
        .join("  "),
    );
  }
}

await prisma.$disconnect();
