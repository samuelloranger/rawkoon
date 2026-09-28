import { z } from "zod";

// APNs rejects an alert payload over 4 KiB with PayloadTooLarge, so the relay
// refuses it at validation time instead of spending a round trip to find out.
export const MAX_APNS_PAYLOAD_BYTES = 4 * 1024;

const pushRequestFields = z.object({
  token: z
    .string()
    .regex(
      /^[0-9a-fA-F]{64}$/,
      "token must be a 64-char hex APNs device token",
    ),
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(400),
  collapseId: z.string().min(1).max(64).optional(),
  data: z.record(z.unknown()).optional(),
});

// Inferred from the fields, not the refined schema, so the size check below can
// reference the request type without the two definitions becoming circular.
export type PushRequest = z.infer<typeof pushRequestFields>;

export const pushRequestSchema = pushRequestFields.refine(
  (req) => apnsPayloadBytes(req) <= MAX_APNS_PAYLOAD_BYTES,
  `payload exceeds the APNs limit of ${MAX_APNS_PAYLOAD_BYTES} bytes`,
);

export function buildApnsPayload(req: PushRequest): Record<string, unknown> {
  // `data` is caller-controlled, so a supplied `aps` is dropped rather than
  // merged — it would otherwise override the alert, sound, and content-available.
  const { aps: _callerAps, ...custom } = req.data ?? {};
  return {
    ...custom,
    aps: {
      alert: { title: req.title, body: req.body },
      sound: "default",
    },
  };
}

// The measured value is the body actually sent to Apple, not the request body.
function apnsPayloadBytes(req: PushRequest): number {
  return new TextEncoder().encode(JSON.stringify(buildApnsPayload(req))).length;
}

// APNs status the caller can act on. 410 = the app was uninstalled; the relay
// is stateless, so it reports that upstream and the caller prunes the token.
export function classifyApnsStatus(
  status: number,
): "ok" | "unregistered" | "retry" | "rejected" {
  if (status === 200) return "ok";
  if (status === 410) return "unregistered";
  if (status === 429 || status >= 500) return "retry";
  return "rejected";
}

const liveState = z.object({
  progress: z.number().min(0).max(1),
  step: z.enum(["preflight", "encode", "validate", "replace", "rescan"]),
  etaSeconds: z.number().int().nonnegative().nullable(),
  status: z.enum(["running", "done", "failed", "cancelled"]),
});

// A finished or failed re-encode stays on the lock screen long enough to be seen.
export const RESULT_VISIBLE_SECS = 15 * 60;

const activityToken = z.string().regex(/^[0-9a-fA-F]{64,512}$/);

export const liveActivityRequestSchema = z.discriminatedUnion("event", [
  z.object({
    event: z.literal("start"),
    token: activityToken,
    state: liveState,
    attributes: z.object({
      jobId: z.number().int().positive(),
      title: z.string().min(1).max(160),
      codec: z.string().min(1).max(16),
    }),
  }),
  z.object({
    event: z.enum(["update", "end"]),
    token: activityToken,
    state: liveState,
  }),
]);

export type LiveActivityRequest = z.infer<typeof liveActivityRequestSchema>;

export function buildLiveActivityPayload(
  req: LiveActivityRequest,
  timestamp: number = Math.floor(Date.now() / 1000),
): Record<string, unknown> {
  const aps: Record<string, unknown> = {
    timestamp,
    event: req.event,
    "content-state": req.state,
  };
  if (req.event === "start") {
    // iOS 18+ returns an update token for a remotely started activity only
    // when the start payload explicitly asks for one.
    aps["input-push-token"] = 1;
    aps["attributes-type"] = "ReencodeActivityAttributes";
    aps.attributes = req.attributes;
    // loc-key resolves against the app's string catalog, so the banner follows the phone's language.
    aps.alert = {
      title: { "loc-key": "Re-encode started" },
      body: req.attributes.title,
    };
  }
  if (req.event === "end")
    aps["dismissal-date"] =
      req.state.status === "cancelled"
        ? timestamp
        : timestamp + RESULT_VISIBLE_SECS;
  return { aps };
}
