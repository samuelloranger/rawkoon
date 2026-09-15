import { readFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { ApnsTokenCache } from "./apnsAuth";
import { APNS_PROD, APNS_SANDBOX, ApnsClient } from "./apnsClient";
import { clientIpFromForwarded } from "./clientIp";
import { Metrics } from "./metrics";
import {
  buildApnsPayload,
  classifyApnsStatus,
  pushRequestSchema,
} from "./payload";
import { RateLimiter } from "./rateLimit";

// Every value here is deployment config — never a default that could silently
// point production at the wrong Apple environment or the wrong app.
const KEY_ID = required("APNS_KEY_ID");
const TEAM_ID = required("APNS_TEAM_ID");
const BUNDLE_ID = required("APNS_BUNDLE_ID");
const KEY_PATH = required("APNS_KEY_PATH");
const PORT = numeric("PORT", 8090);
// Wrong by one and every request is bucketed against the wrong address, so a
// malformed value stops the process rather than quietly weakening the limiter.
const TRUSTED_PROXY_HOPS = numeric("TRUSTED_PROXY_HOPS", 1);
const METRICS_TOKEN = process.env.METRICS_TOKEN ?? "";
const MAX_BODY_BYTES = 8 * 1024;
const HOST = process.env.APNS_ENV === "sandbox" ? APNS_SANDBOX : APNS_PROD;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function numeric(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer, got ${raw}`);
  }
  return value;
}

const tokens = new ApnsTokenCache({
  keyId: KEY_ID,
  teamId: TEAM_ID,
  privateKeyPem: readFileSync(KEY_PATH, "utf8"),
});
const apns = new ApnsClient(tokens, HOST);
const metrics = new Metrics();

// Bucket keys are partly caller-influenced, so both limiters carry RateLimiter's
// default key cap and its fail-closed behaviour once that cap is reached.
const perToken = new RateLimiter(10, 1 / 6);
const perIp = new RateLimiter(60, 1);
setInterval(() => {
  perToken.sweep();
  perIp.sweep();
}, 60_000).unref?.();

/**
 * The peer to rate-limit against, or null when it cannot be established.
 *
 * Behind a reverse proxy the only honest source is X-Forwarded-For read at the
 * trusted hop count. With no proxy the header is entirely attacker-controlled,
 * so the socket address is used instead — an attacker who could choose his own
 * bucket key would otherwise bypass the per-IP limit outright.
 */
function resolvePeer(c: {
  req: { header: (name: string) => string | undefined; raw: Request };
  env: unknown;
}): string | null {
  if (TRUSTED_PROXY_HOPS > 0) {
    return clientIpFromForwarded(
      c.req.header("x-forwarded-for"),
      TRUSTED_PROXY_HOPS,
    );
  }
  const server = c.env as
    | { requestIP?: (req: Request) => { address?: string } | null }
    | undefined;
  return server?.requestIP?.(c.req.raw)?.address ?? null;
}

function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const app = new Hono();

// Reports whether this relay can actually deliver: that the APNs key still
// signs, and that recent sends have not been failing in a row. A flat `ok:true`
// stayed green through a revoked key while every push failed.
app.get("/health", (c) => {
  let signable = true;
  try {
    tokens.get();
  } catch {
    signable = false;
  }
  const ok = signable && !metrics.upstreamLooksBroken;
  return c.json(
    { ok, signable, upstream: metrics.upstreamLooksBroken ? "failing" : "ok" },
    ok ? 200 : 503,
  );
});

// Operational counters, never content. Disabled unless a token is configured.
app.get("/metrics", (c) => {
  if (!METRICS_TOKEN) return c.json({ error: "not_found" }, 404);
  const provided = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (!provided || !tokenMatches(provided, METRICS_TOKEN)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  return c.json({
    ...metrics.snapshot(),
    buckets: { perToken: perToken.size, perIp: perIp.size },
  });
});

app.post("/push", async (c) => {
  // Rate-limit before reading the body: /push is public, so parsing first would
  // let an attacker spend memory on a huge JSON the schema always rejects.
  const ip = resolvePeer(c);
  if (ip === null) {
    metrics.record("untrusted_peer");
    return c.json({ error: "untrusted_peer" }, 403);
  }
  if (!perIp.take(ip)) {
    metrics.record("rate_limited_ip");
    return c.json({ error: "rate_limited" }, 429);
  }

  const declared = Number(c.req.header("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) {
    metrics.record("payload_too_large");
    return c.json({ error: "payload_too_large" }, 413);
  }
  const raw = await c.req.text().catch(() => "");
  if (raw.length > MAX_BODY_BYTES) {
    metrics.record("payload_too_large");
    return c.json({ error: "payload_too_large" }, 413);
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(raw);
  } catch {
    metrics.record("invalid_request");
    return c.json(
      { error: "invalid_request", detail: "body must be JSON" },
      400,
    );
  }
  const parsed = pushRequestSchema.safeParse(parsedBody);
  if (!parsed.success) {
    metrics.record("invalid_request");
    return c.json(
      { error: "invalid_request", detail: parsed.error.issues[0]?.message },
      400,
    );
  }
  const req = parsed.data;
  if (!perToken.take(req.token)) {
    metrics.record("rate_limited_token");
    return c.json({ error: "rate_limited" }, 429);
  }

  let result: Awaited<ReturnType<ApnsClient["send"]>>;
  try {
    result = await apns.send({
      token: req.token,
      payload: buildApnsPayload(req),
      topic: BUNDLE_ID,
      collapseId: req.collapseId,
    });
  } catch (error) {
    metrics.record("transport_error");
    console.warn(
      "apns transport error:",
      error instanceof Error ? error.message : error,
    );
    return c.json({ error: "upstream_unavailable" }, 502);
  }

  switch (classifyApnsStatus(result.status)) {
    case "ok":
      metrics.record("ok");
      return c.json({ ok: true });
    case "unregistered":
      metrics.record("unregistered");
      return c.json({ error: "unregistered" }, 410);
    case "retry":
      metrics.record("retry", result.reason);
      return c.json({ error: "upstream_busy", reason: result.reason }, 503);
    default:
      metrics.record("rejected", result.reason);
      return c.json({ error: "rejected", reason: result.reason }, 400);
  }
});

console.log(
  `rawkoon-relay listening on :${PORT} (${HOST}, topic ${BUNDLE_ID})`,
);
export default { port: PORT, fetch: app.fetch };
