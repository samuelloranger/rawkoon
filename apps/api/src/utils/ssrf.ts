import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";

const NAT64_WELL_KNOWN = [0x00, 0x64, 0xff, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0];

// Forms that carry an IPv4 are classified by that IPv4: IPv4-compatible
// (::/96, which ipaddr leaves as unicast), well-known NAT64 (64:ff9b::/96)
// and 6to4 (2002::/16). Local-use NAT64 (64:ff9b:1::/48) keeps its own
// "rfc6052" range and so stays blocked under both policies.
function parseIp(ip: string): ipaddr.IPv4 | ipaddr.IPv6 | null {
  if (isIP(ip) === 0) return null;
  try {
    const addr = ipaddr.process(ip);
    if (addr.kind() === "ipv4") return addr;
    const b = addr.toByteArray();
    if (b.slice(0, 12).every((x) => x === 0)) {
      return ipaddr.fromByteArray(b.slice(12, 16));
    }
    if (NAT64_WELL_KNOWN.every((x, i) => b[i] === x)) {
      return ipaddr.fromByteArray(b.slice(12, 16));
    }
    if (b[0] === 0x20 && b[1] === 0x02) {
      return ipaddr.fromByteArray(b.slice(2, 6));
    }
    return addr;
  } catch {
    return null;
  }
}

/** Strict policy for user-supplied outbound targets: anything not globally routable is blocked. */
export function isPrivateIP(ip: string): boolean {
  const addr = parseIp(ip);
  if (!addr) return true;
  return addr.range() !== "unicast";
}

const LAN_ALLOWED_RANGES = new Set([
  "unicast",
  "private",
  "uniqueLocal",
  "carrierGradeNat",
]);

/** LAN policy: private/ULA/CGNAT are fine, loopback/link-local/multicast/reserved are not. */
export function isBlockedForLanFetch(ip: string): boolean {
  const addr = parseIp(ip);
  if (!addr) return true;
  return !LAN_ALLOWED_RANGES.has(addr.range());
}

export async function validateSafeUrl(urlStr: string): Promise<string> {
  const url = new URL(urlStr);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Invalid protocol: ${url.protocol}`);
  }

  const hostname = url.hostname;

  // If host is already an IP, check it
  if (isIP(hostname)) {
    if (isPrivateIP(hostname)) {
      throw new Error(
        `Outbound URL target IP is blocked (private/local range): ${hostname}`,
      );
    }
    return urlStr;
  }

  // If host is a hostname, resolve it
  try {
    const addresses = await lookup(hostname, { all: true });
    for (const addr of addresses) {
      if (isPrivateIP(addr.address)) {
        throw new Error(
          `Outbound URL host resolves to blocked IP (private/local range): ${addr.address}`,
        );
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("blocked IP")) {
      throw err;
    }
    throw new Error(`DNS resolution failed for host: ${hostname}`, {
      cause: err,
    });
  }

  return urlStr;
}

const DEFAULT_MAX_REDIRECTS = 5;

/** "public": only globally routable targets. "lan": also private/ULA/CGNAT (indexers on the LAN). */
export type OutboundPolicy = "public" | "lan";

const isBlockedBy = (policy: OutboundPolicy, ip: string) =>
  policy === "lan" ? isBlockedForLanFetch(ip) : isPrivateIP(ip);

// Headers that carry no credentials, so they may follow a cross-origin redirect.
const CROSS_ORIGIN_SAFE_HEADERS = new Set([
  "accept",
  "accept-language",
  "user-agent",
  "content-type",
]);

// Resolves the host once and rejects it if any answer is blocked; returns
// every validated address, IPv4 first, so callers can fall back between them.
export async function resolveAllowedIps(
  url: URL,
  policy: OutboundPolicy = "public",
): Promise<string[]> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Invalid protocol: ${url.protocol}`);
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname)) {
    if (isBlockedBy(policy, hostname)) {
      throw new Error(
        `Outbound URL target IP is blocked (private/local range): ${hostname}`,
      );
    }
    return [hostname];
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch (err) {
    throw new Error(`DNS resolution failed for host: ${hostname}`, {
      cause: err,
    });
  }
  if (addresses.length === 0) {
    throw new Error(`DNS resolution returned no addresses for: ${hostname}`);
  }
  for (const addr of addresses) {
    if (isBlockedBy(policy, addr.address)) {
      throw new Error(
        `Outbound URL host resolves to blocked IP (private/local range): ${addr.address}`,
      );
    }
  }
  const ips = addresses.map((a) => a.address);
  return [
    ...ips.filter((ip) => isIP(ip) === 4),
    ...ips.filter((ip) => isIP(ip) !== 4),
  ];
}

// Same origin, or an http→https upgrade on the same host, may keep credentials.
function keepsCredentials(from: URL, to: URL): boolean {
  if (to.origin === from.origin) return true;
  return (
    from.protocol === "http:" &&
    to.protocol === "https:" &&
    to.hostname === from.hostname
  );
}

export type SafeFetchOptions = {
  policy?: OutboundPolicy;
  maxRedirects?: number;
  /** Called with each redirect target before it is validated; throw to abort. */
  onRedirect?: (next: URL) => void;
};

/**
 * SSRF-safe fetch. Resolves the target host, rejects any blocked address for
 * the policy, then pins the connection to the validated IP so a DNS-rebinding
 * response can't swap in another address between the check and the request.
 *
 * Redirects are followed here, never by `fetch`: every hop is re-validated and
 * re-pinned, so a permitted host can't bounce the request to a blocked address,
 * and credential headers are dropped when a hop changes origin.
 * TLS still validates against the original hostname via SNI (`tls.serverName`),
 * and the `Host` header preserves virtual-host routing now that we connect by IP.
 */
export async function safeFetch(
  urlStr: string,
  init?: RequestInit,
  opts: SafeFetchOptions = {},
): Promise<Response> {
  const {
    policy = "public",
    maxRedirects = DEFAULT_MAX_REDIRECTS,
    onRedirect,
  } = opts;
  let url = new URL(urlStr);
  let method = (init?.method ?? "GET").toUpperCase();
  let body = init?.body;
  const headers = new Headers(init?.headers);
  const callerHost = headers.get("host");
  const existingTls = (init as { tls?: Record<string, unknown> } | undefined)
    ?.tls;

  for (let hop = 0; ; hop++) {
    const ips = await resolveAllowedIps(url, policy);
    const hostname = url.hostname.replace(/^\[|\]$/g, "");

    const hopHeaders = new Headers(headers);
    hopHeaders.set("Host", hop === 0 && callerHost ? callerHost : url.host);

    const hopInit: RequestInit & { tls?: Record<string, unknown> } = {
      ...init,
      method,
      body,
      headers: hopHeaders,
      redirect: "manual",
    };
    delete hopInit.tls;
    if (url.protocol === "https:") {
      hopInit.tls = { ...existingTls, serverName: hostname };
    }

    let res: Response | undefined;
    let lastError: unknown;
    for (const ip of ips) {
      const pinnedUrl = new URL(url);
      pinnedUrl.hostname = isIP(ip) === 6 ? `[${ip}]` : ip;
      try {
        res = await fetch(pinnedUrl.toString(), hopInit as RequestInit);
        break;
      } catch (err) {
        if (hopInit.signal?.aborted) throw err;
        lastError = err;
      }
    }
    if (!res) throw lastError;
    if (res.status < 300 || res.status >= 400) return res;

    const location = res.headers.get("location")?.trim();
    if (!location) return res;

    await res.body?.cancel().catch(() => {});
    if (hop >= maxRedirects) throw new Error("Too many redirects");

    const next = new URL(location, url);
    onRedirect?.(next);
    if (!keepsCredentials(url, next)) {
      for (const name of [...headers.keys()]) {
        if (!CROSS_ORIGIN_SAFE_HEADERS.has(name)) headers.delete(name);
      }
    }
    const toGet =
      res.status === 303
        ? method !== "GET" && method !== "HEAD"
        : (res.status === 301 || res.status === 302) &&
          method !== "GET" &&
          method !== "HEAD";
    if (toGet) {
      method = "GET";
      body = undefined;
      headers.delete("content-type");
      headers.delete("content-length");
    }
    url = next;
  }
}
