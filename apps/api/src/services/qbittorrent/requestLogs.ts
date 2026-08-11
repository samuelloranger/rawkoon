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

/**
 * Explicit override. When set, it applies uniformly to every request — no
 * endpoint or outcome exceptions — so the knob stays predictable.
 */
const EXPLICIT_SAMPLE_RATE = (() => {
  const raw = process.env.QBITTORRENT_REQUEST_LOG_SAMPLE_RATE;
  if (raw == null || raw.trim() === "") return null;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(1, Math.max(0, parsed));
})();

/**
 * The high-frequency poll. It ran at one log row per call every 20s while a
 * download was active, and accounted for 92% of the table (302k of 327k rows on
 * a real instance) — all of it near-identical successful polls.
 */
const POLL_ENDPOINT = "/api/v2/sync/maindata";
const POLL_SAMPLE_RATE = 0.05;

/**
 * Failures are the rows with debugging value and a small fraction of volume, so
 * they are never sampled away. Everything except the poll is still logged in
 * full — those calls are driven by user actions, not a timer.
 */
function sampleRateFor(endpoint: string, ok: boolean): number {
  if (EXPLICIT_SAMPLE_RATE !== null) return EXPLICIT_SAMPLE_RATE;
  if (!ok) return 1;
  return endpoint === POLL_ENDPOINT ? POLL_SAMPLE_RATE : 1;
}

const shouldSample = (endpoint: string, ok: boolean) => {
  if (!LOGGING_ENABLED) return false;
  const rate = sampleRateFor(endpoint, ok);
  if (rate <= 0) return false;
  if (rate >= 1) return true;
  return Math.random() <= rate;
};

// Cap concurrent fire-and-forget log inserts so a slow/unavailable DB can't let
// unawaited promises pile up unbounded. Logging is best-effort — shed on overflow.
const MAX_INFLIGHT_LOGS = 50;
let inFlightLogs = 0;

export function logQbittorrentRequest(input: QbittorrentRequestLogInput) {
  if (!shouldSample(input.endpoint, input.ok)) return;
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
