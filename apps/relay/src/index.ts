import { type Context, Hono } from "hono";
import { ApnsTokenCache } from "./apnsAuth";
import {
  APNS_PROD,
  APNS_SANDBOX,
  ApnsClient,
  type ApnsSendOptions,
} from "./apnsClient";
import {
  buildApnsPayload,
  buildLiveActivityPayload,
  classifyApnsStatus,
  liveActivityRequestSchema,
  MAX_APNS_PAYLOAD_BYTES,
  pushRequestSchema,
} from "./payload";

// Bindings come from worker-configuration.d.ts (`wrangler types`); the APNs
// values are Worker secrets, which the config can't describe, so they're added
// here. Each is deployment config — never a default that could silently point
// production at the wrong Apple environment or the wrong app.
declare global {
  interface Env {
    APNS_KEY_ID: string;
    APNS_TEAM_ID: string;
    APNS_BUNDLE_ID: string;
    /** Contents of the .p8 key. */
    APNS_PRIVATE_KEY: string;
    APNS_ENV?: string;
  }
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

  // Shared front door for the public POST routes: edge-only peer, per-IP limit
  // before the body is read, size cap, then JSON. Returns the parsed body or the
  // rejection to send.
  async function readPublicJson(
    c: Context<{ Bindings: Env }>,
  ): Promise<{ body: unknown } | { reject: Response }> {
    // Set by Cloudflare's edge; a caller cannot forge it. Without it the
    // request didn't come through the edge, so there is no key to limit on.
    const ip = c.req.header("cf-connecting-ip");
    if (!ip) return { reject: c.json({ error: "untrusted_peer" }, 403) };
    // Rate-limit before reading the body: these routes are public, so parsing
    // first would let an attacker spend CPU on a huge JSON the schema rejects.
    if (!(await c.env.PER_IP.limit({ key: ip })).success) {
      return { reject: c.json({ error: "rate_limited" }, 429) };
    }

    const declared = Number(c.req.header("content-length") ?? 0);
    if (declared > MAX_BODY_BYTES) {
      return { reject: c.json({ error: "payload_too_large" }, 413) };
    }
    const raw = await c.req.text().catch(() => "");
    if (raw.length > MAX_BODY_BYTES) {
      return { reject: c.json({ error: "payload_too_large" }, 413) };
    }

    try {
      return { body: JSON.parse(raw) };
    } catch {
      return {
        reject: c.json(
          { error: "invalid_request", detail: "body must be JSON" },
          400,
        ),
      };
    }
  }

  async function deliver(
    c: Context<{ Bindings: Env }>,
    opts: Omit<ApnsSendOptions, "topic">,
    topic: (bundleId: string) => string,
  ): Promise<Response> {
    const { apns, topic: bundleId } = relayFor(c.env);
    let result: Awaited<ReturnType<ApnsClient["send"]>>;
    try {
      result = await apns.send({ ...opts, topic: topic(bundleId) });
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
  }

  app.post("/push", async (c) => {
    const read = await readPublicJson(c);
    if ("reject" in read) return read.reject;
    const parsed = pushRequestSchema.safeParse(read.body);
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

    return deliver(
      c,
      {
        token: req.token,
        payload: buildApnsPayload(req),
        collapseId: req.collapseId,
      },
      (bundleId) => bundleId,
    );
  });

  // ActivityKit uses a distinct APNs topic and push type. Accept only the
  // ReencodeActivityAttributes shape we ship, never a caller-supplied aps object.
  app.post("/liveactivity", async (c) => {
    const read = await readPublicJson(c);
    if ("reject" in read) return read.reject;
    const parsed = liveActivityRequestSchema.safeParse(read.body);
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

    const payload = buildLiveActivityPayload(req);
    if (
      new TextEncoder().encode(JSON.stringify(payload)).length >
      MAX_APNS_PAYLOAD_BYTES
    ) {
      return c.json({ error: "payload_too_large" }, 413);
    }

    return deliver(
      c,
      {
        token: req.token,
        payload,
        pushType: "liveactivity",
        priority: req.event === "start" ? 10 : 5,
      },
      (bundleId) => `${bundleId}.push-type.liveactivity`,
    );
  });

  return app;
}

export default createApp();
