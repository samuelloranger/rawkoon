import http2 from "node:http2";
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

// APNs speaks HTTP/2 only, so this cannot use fetch. One session is kept open
// and multiplexed — Apple throttles clients that reconnect per push.
export class ApnsClient {
  private session: http2.ClientHttp2Session | null = null;

  constructor(
    private readonly tokens: ApnsTokenCache,
    private readonly host: string = APNS_PROD,
  ) {}

  private connect(): http2.ClientHttp2Session {
    if (this.session && !this.session.closed && !this.session.destroyed) return this.session;
    const session = http2.connect(this.host);
    session.on("error", () => {
      if (this.session === session) this.session = null;
    });
    session.on("close", () => {
      if (this.session === session) this.session = null;
    });
    this.session = session;
    return session;
  }

  send(opts: ApnsSendOptions): Promise<ApnsResult> {
    const body = JSON.stringify(opts.payload);
    return new Promise((resolve, reject) => {
      const req = this.connect().request({
        ":method": "POST",
        ":path": `/3/device/${opts.token}`,
        authorization: `bearer ${this.tokens.get()}`,
        "apns-topic": opts.topic,
        "apns-push-type": "alert",
        "apns-priority": "10",
        ...(opts.collapseId ? { "apns-collapse-id": opts.collapseId } : {}),
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
      });
      let status = 0;
      let raw = "";
      req.setEncoding("utf8");
      req.on("response", (headers) => {
        status = Number(headers[":status"] ?? 0);
      });
      req.on("data", (chunk: string) => {
        raw += chunk;
      });
      req.on("end", () => {
        let reason: string | undefined;
        if (raw) {
          try {
            reason = (JSON.parse(raw) as { reason?: string }).reason;
          } catch {
            reason = raw.slice(0, 200);
          }
        }
        resolve({ status, reason });
      });
      req.on("error", reject);
      req.setTimeout(10_000, () => {
        req.close();
        reject(new Error("APNs request timed out"));
      });
      req.end(body);
    });
  }
}
