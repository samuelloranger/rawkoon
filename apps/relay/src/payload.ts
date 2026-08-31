import { z } from "zod";

export const pushRequestSchema = z.object({
  token: z.string().regex(/^[0-9a-fA-F]{64}$/, "token must be a 64-char hex APNs device token"),
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(400),
  collapseId: z.string().min(1).max(64).optional(),
  data: z.record(z.unknown()).optional(),
});

export type PushRequest = z.infer<typeof pushRequestSchema>;

export function buildApnsPayload(req: PushRequest): Record<string, unknown> {
  return {
    aps: {
      alert: { title: req.title, body: req.body },
      sound: "default",
    },
    ...(req.data ?? {}),
  };
}

// APNs status the caller can act on. 410 = the app was uninstalled; the relay
// is stateless, so it reports that upstream and the caller prunes the token.
export function classifyApnsStatus(status: number): "ok" | "unregistered" | "retry" | "rejected" {
  if (status === 200) return "ok";
  if (status === 410) return "unregistered";
  if (status === 429 || status >= 500) return "retry";
  return "rejected";
}
