import { Hono } from "hono";
import { ApnsTokenCache } from "./apnsAuth";
import { APNS_PROD, APNS_SANDBOX, ApnsClient } from "./apnsClient";
import {
  buildApnsPayload,
  classifyApnsStatus,
  pushRequestSchema,
} from "./payload";

// Cloudflare's Rate Limiting binding; declared here rather than pulling in the
// full workers-types package, whose globals clash with bun-types in the tests.
export interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

// Every value here is deployment config — never a default that could silently
// point production at the wrong Apple environment or the wrong app.
export interface Env {
  APNS_KEY_ID: string;
  APNS_TEAM_ID: string;
  APNS_BUNDLE_ID: string;
  /** Contents of the .p8 key, stored as a Worker secret. */
  APNS_PRIVATE_KEY: string;
  APNS_ENV?: string;
  PER_IP: RateLimit;
  PER_TOKEN: RateLimit;
}

const MAX_BODY_BYTES = 8 * 1024;

interface Relay {
  tokens: ApnsTokenCache;
  apns: ApnsClient;
  topic: string;
}

function required(env: Env, name: keyof Env): string {
  const value = env[name];
  if (typeof value !== "string" || value === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}

export function createApp(fetchImpl: typeof fetch = fetch) {
  // One per isolate, so the signed JWT is reused across requests as Apple asks.
  let relay: Relay | null = null;
  const relayFor = (env: Env): Relay => {
    if (relay) return relay;
    const tokens = new ApnsTokenCache({
      keyId: required(env, "APNS_KEY_ID"),
      teamId: required(env, "APNS_TEAM_ID"),
      privateKeyPem: required(env, "APNS_PRIVATE_KEY"),
    });
    const host = env.APNS_ENV === "sandbox" ? APNS_SANDBOX : APNS_PROD;
    relay = {
      tokens,
      apns: new ApnsClient(tokens, host, fetchImpl),
      topic: required(env, "APNS_BUNDLE_ID"),
    };
    return relay;
  };

  const app = new Hono<{ Bindings: Env }>();

  // Reports whether this relay can actually deliver: a flat `ok:true` stayed
  // green through a revoked key while every push failed.
  app.get("/health", async (c) => {
    let signable = true;
    try {
      await relayFor(c.env).tokens.get();
    } catch {
      signable = false;
    }
    return c.json({ ok: signable, signable }, signable ? 200 : 503);
  });

  app.post("/push", async (c) => {
    // Set by Cloudflare's edge; a caller cannot forge it. Without it the
    // request didn't come through the edge, so there is no key to limit on.
    const ip = c.req.header("cf-connecting-ip");
    if (!ip) return c.json({ error: "untrusted_peer" }, 403);
    // Rate-limit before reading the body: /push is public, so parsing first
    // would let an attacker spend CPU on a huge JSON the schema always rejects.
    if (!(await c.env.PER_IP.limit({ key: ip })).success) {
      return c.json({ error: "rate_limited" }, 429);
    }

    const declared = Number(c.req.header("content-length") ?? 0);
    if (declared > MAX_BODY_BYTES) {
      return c.json({ error: "payload_too_large" }, 413);
    }
    const raw = await c.req.text().catch(() => "");
    if (raw.length > MAX_BODY_BYTES) {
      return c.json({ error: "payload_too_large" }, 413);
    }

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
    if (!(await c.env.PER_TOKEN.limit({ key: req.token })).success) {
      return c.json({ error: "rate_limited" }, 429);
    }

    const { apns, topic } = relayFor(c.env);
    let result: Awaited<ReturnType<ApnsClient["send"]>>;
    try {
      result = await apns.send({
        token: req.token,
        payload: buildApnsPayload(req),
        topic,
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

  return app;
}

export default createApp();
