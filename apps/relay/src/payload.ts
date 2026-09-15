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
  return Buffer.byteLength(JSON.stringify(buildApnsPayload(req)), "utf8");
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
