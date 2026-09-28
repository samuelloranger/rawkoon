import type { ApnsTokenCache } from "./apnsAuth";

export const APNS_PROD = "https://api.push.apple.com";
export const APNS_SANDBOX = "https://api.sandbox.push.apple.com";

export interface ApnsResult {
  status: number;
  reason?: string;
}

export interface ApnsSendOptions {
  token: string;
  payload: Record<string, unknown>;
  topic: string;
  collapseId?: string;
}

const TIMEOUT_MS = 10_000;

// APNs accepts HTTP/2 only. A Worker's fetch() is HTTP/1.1, but Cloudflare's
// edge speaks HTTP/2 to Apple on its behalf and pools those connections, so a
// plain fetch per push is how this runs in production. (`wrangler dev` has no
// such edge, so pushes only work from a deployed Worker.)
export class ApnsClient {
  constructor(
    private readonly tokens: ApnsTokenCache,
    private readonly host: string = APNS_PROD,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(opts: ApnsSendOptions): Promise<ApnsResult> {
    const res = await this.fetchImpl(`${this.host}/3/device/${opts.token}`, {
      method: "POST",
      headers: {
        authorization: `bearer ${await this.tokens.get()}`,
        "apns-topic": opts.topic,
        "apns-push-type": "alert",
        "apns-priority": "10",
        ...(opts.collapseId ? { "apns-collapse-id": opts.collapseId } : {}),
        "content-type": "application/json",
      },
      body: JSON.stringify(opts.payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const raw = await res.text();
    let reason: string | undefined;
    if (raw) {
      try {
        reason = (JSON.parse(raw) as { reason?: string }).reason;
      } catch {
        reason = raw.slice(0, 200);
      }
    }
    return { status: res.status, reason };
  }
}
