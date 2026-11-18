import { incrCache, ttlCache } from "@rawkoon/api/services/cache";

export const MCP_READ_LIMIT_PER_MINUTE = 60;
export const MCP_ACTION_LIMIT_PER_HOUR = 10;

const READ_WINDOW_SECONDS = 60;
const ACTION_WINDOW_SECONDS = 60 * 60;

export type McpRateKind = "read" | "action";

export interface RateVerdict {
  allowed: boolean;
  /** Seconds until the window resets; only meaningful when refused. */
  retryAfterSeconds: number;
}

/**
 * Fixed-window counters per key in Valkey. A Valkey outage fails open: the
 * anonymous global limiter still caps unauthenticated traffic, and per-key
 * limits are a throttle, not a security boundary.
 */
export async function checkMcpRateLimit(
  keyId: string,
  kind: McpRateKind,
): Promise<RateVerdict> {
  const key = `mcp:rl:${keyId}:${kind}`;
  const [max, windowSeconds] =
    kind === "read"
      ? [MCP_READ_LIMIT_PER_MINUTE, READ_WINDOW_SECONDS]
      : [MCP_ACTION_LIMIT_PER_HOUR, ACTION_WINDOW_SECONDS];
  try {
    const count = await incrCache(key, windowSeconds);
    if (count === null) return { allowed: true, retryAfterSeconds: 0 };
    if (count <= max) return { allowed: true, retryAfterSeconds: 0 };
    const ttl = await ttlCache(key);
    return {
      allowed: false,
      retryAfterSeconds: ttl > 0 ? ttl : windowSeconds,
    };
  } catch {
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

export function rateLimitMessage(kind: McpRateKind, retry: number): string {
  return kind === "read"
    ? `Rate limit reached: this API key allows at most ${MCP_READ_LIMIT_PER_MINUTE} read tools per minute. Try again in ${retry} seconds.`
    : `Rate limit reached: this API key allows at most ${MCP_ACTION_LIMIT_PER_HOUR} actions per hour. Try again in ${Math.ceil(retry / 60)} minutes.`;
}
