import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { ApnsTokenCache } from "./apnsAuth";
import { APNS_PROD, APNS_SANDBOX, ApnsClient } from "./apnsClient";
import { clientIpFromForwarded } from "./clientIp";
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
const PORT = Number(process.env.PORT ?? 8090);
const TRUSTED_PROXY_HOPS = Number(process.env.TRUSTED_PROXY_HOPS ?? 1);
const MAX_BODY_BYTES = 8 * 1024;
const HOST = process.env.APNS_ENV === "sandbox" ? APNS_SANDBOX : APNS_PROD;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const tokens = new ApnsTokenCache({
  keyId: KEY_ID,
  teamId: TEAM_ID,
  privateKeyPem: readFileSync(KEY_PATH, "utf8"),
});
const apns = new ApnsClient(tokens, HOST);

const perToken = new RateLimiter(10, 1 / 6);
const perIp = new RateLimiter(60, 1);
setInterval(() => {
  perToken.sweep();
  perIp.sweep();
}, 60_000).unref?.();

const app = new Hono();
app.get("/health", (c) => c.json({ ok: true }));

app.post("/push", async (c) => {
  // Rate-limit before reading the body: /push is public, so parsing first would
  // let an attacker spend memory on a huge JSON the schema always rejects.
  const ip = clientIpFromForwarded(
    c.req.header("x-forwarded-for"),
    TRUSTED_PROXY_HOPS,
  );
  if (!perIp.take(ip)) return c.json({ error: "rate_limited" }, 429);

  const declared = Number(c.req.header("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES)
    return c.json({ error: "payload_too_large" }, 413);
  const raw = await c.req.text().catch(() => "");
  if (raw.length > MAX_BODY_BYTES)
    return c.json({ error: "payload_too_large" }, 413);

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(raw);
  } catch {
    return c.json(
      { error: "invalid_request", detail: "body must be JSON" },
      400,
    );
  }
  const parsed = pushRequestSchema.safeParse(parsedBody);
  if (!parsed.success) {
    return c.json(
      { error: "invalid_request", detail: parsed.error.issues[0]?.message },
      400,
    );
  }
  const req = parsed.data;
  if (!perToken.take(req.token)) return c.json({ error: "rate_limited" }, 429);

  let result: Awaited<ReturnType<ApnsClient["send"]>>;
  try {
    result = await apns.send({
      token: req.token,
      payload: buildApnsPayload(req),
      topic: BUNDLE_ID,
      collapseId: req.collapseId,
    });
  } catch (error) {
    console.warn(
      "apns transport error:",
      error instanceof Error ? error.message : error,
    );
    return c.json({ error: "upstream_unavailable" }, 502);
  }

  switch (classifyApnsStatus(result.status)) {
    case "ok":
      return c.json({ ok: true });
    case "unregistered":
      return c.json({ error: "unregistered" }, 410);
    case "retry":
      return c.json({ error: "upstream_busy", reason: result.reason }, 503);
    default:
      return c.json({ error: "rejected", reason: result.reason }, 400);
  }
});

console.log(
  `rawkoon-relay listening on :${PORT} (${HOST}, topic ${BUNDLE_ID})`,
);
export default { port: PORT, fetch: app.fetch };
