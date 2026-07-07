import { prisma } from "@rawkoon/api/db";

type QbittorrentRequestLogInput = {
  method: string;
  endpoint: string;
  requestPath: string;
  statusCode?: number | null;
  ok: boolean;
  durationMs: number;
  responseBytes?: number | null;
  authRetried?: boolean;
  rid?: number | null;
  fullUpdate?: boolean | null;
  itemCount?: number | null;
  removedCount?: number | null;
  errorMessage?: string | null;
  meta?: unknown;
};

const LOGGING_ENABLED =
  (process.env.QBITTORRENT_REQUEST_LOGGING_ENABLED ?? "true").toLowerCase() !==
  "false";
const SAMPLE_RATE = Math.min(
  1,
  Math.max(
    0,
    Number.parseFloat(process.env.QBITTORRENT_REQUEST_LOG_SAMPLE_RATE ?? "1") ||
      1,
  ),
);

const shouldSample = () =>
  LOGGING_ENABLED && SAMPLE_RATE > 0 && Math.random() <= SAMPLE_RATE;

// Cap concurrent fire-and-forget log inserts so a slow/unavailable DB can't let
// unawaited promises pile up unbounded. Logging is best-effort — shed on overflow.
const MAX_INFLIGHT_LOGS = 50;
let inFlightLogs = 0;

export function logQbittorrentRequest(input: QbittorrentRequestLogInput) {
  if (!shouldSample()) return;
  if (inFlightLogs >= MAX_INFLIGHT_LOGS) return;
  inFlightLogs++;

  void prisma.$executeRaw`
      INSERT INTO "qbittorrent_request_logs" (
        "method",
        "endpoint",
        "request_path",
        "status_code",
        "ok",
        "duration_ms",
        "response_bytes",
        "auth_retried",
        "rid",
        "full_update",
        "item_count",
        "removed_count",
        "error_message",
        "meta"
      ) VALUES (
        ${input.method},
        ${input.endpoint},
        ${input.requestPath},
        ${input.statusCode ?? null},
        ${input.ok},
        ${Math.max(0, Math.trunc(input.durationMs))},
        ${input.responseBytes ?? null},
        ${input.authRetried ?? false},
        ${input.rid ?? null},
        ${input.fullUpdate ?? null},
        ${input.itemCount ?? null},
        ${input.removedCount ?? null},
        ${input.errorMessage ?? null},
        CAST(${input.meta == null ? null : JSON.stringify(input.meta)} AS jsonb)
      )
    `
    .catch((error: unknown) => {
      console.warn(
        "[qBittorrentRequestLog] Failed to persist request log:",
        error,
      );
    })
    .finally(() => {
      inFlightLogs--;
    });
}
