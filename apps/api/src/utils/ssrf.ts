import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";

function parseIp(ip: string): ipaddr.IPv4 | ipaddr.IPv6 | null {
  if (isIP(ip) === 0) return null;
  try {
    const addr = ipaddr.process(ip);
    // ipaddr leaves IPv4-compatible ::a.b.c.d (::/96) as plain unicast IPv6.
    if (addr.kind() === "ipv6") {
      const b = addr.toByteArray();
      if (b.slice(0, 12).every((x) => x === 0)) {
        return ipaddr.fromByteArray(b.slice(12, 16));
      }
    }
    return addr;
  } catch {
    return null;
  }
}

// The IPv4 address hidden inside NAT64 (64:ff9b::/96) and 6to4 (2002::/16) forms.
function embeddedIPv4(addr: ipaddr.IPv6): ipaddr.IPv4 | null {
  const range = addr.range();
  const b = addr.toByteArray();
  if (range === "rfc6052")
    return ipaddr.fromByteArray(b.slice(12, 16)) as ipaddr.IPv4;
  if (range === "6to4")
    return ipaddr.fromByteArray(b.slice(2, 6)) as ipaddr.IPv4;
  return null;
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
  if (addr.kind() === "ipv6") {
    const inner = embeddedIPv4(addr as ipaddr.IPv6);
    if (inner) return !LAN_ALLOWED_RANGES.has(inner.range());
  }
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

const MAX_REDIRECT_HOPS = 5;

// Resolves the host once and rejects any blocked address; returns the IP to pin.
async function resolvePinnedIp(url: URL): Promise<string> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Invalid protocol: ${url.protocol}`);
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname)) {
    if (isPrivateIP(hostname)) {
      throw new Error(
        `Outbound URL target IP is blocked (private/local range): ${hostname}`,
      );
    }
    return hostname;
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
    if (isPrivateIP(addr.address)) {
      throw new Error(
        `Outbound URL host resolves to blocked IP (private/local range): ${addr.address}`,
      );
    }
  }
  return addresses[0].address;
}

/**
 * SSRF-safe fetch. Resolves the target host, rejects any private/local
 * address, then pins the connection to the validated IP so a DNS-rebinding
 * response can't swap in a private address between the check and the request.
 *
 * Redirects are followed here, never by `fetch`: every hop is re-validated and
 * re-pinned, so a public host can't bounce the request to an internal address.
 * TLS still validates against the original hostname via SNI (`tls.serverName`),
 * and the `Host` header preserves virtual-host routing now that we connect by IP.
 */
export async function safeFetch(
  urlStr: string,
  init?: RequestInit,
): Promise<Response> {
  let url = new URL(urlStr);
  let method = (init?.method ?? "GET").toUpperCase();
  let body = init?.body;
  const headers = new Headers(init?.headers);
  const callerHost = headers.get("host");
  const existingTls = (init as { tls?: Record<string, unknown> } | undefined)
    ?.tls;

  for (let hop = 0; ; hop++) {
    const pinnedIp = await resolvePinnedIp(url);
    const hostname = url.hostname.replace(/^\[|\]$/g, "");

    const pinnedUrl = new URL(url);
    pinnedUrl.hostname = isIP(pinnedIp) === 6 ? `[${pinnedIp}]` : pinnedIp;

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

    const res = await fetch(pinnedUrl.toString(), hopInit as RequestInit);
    if (res.status < 300 || res.status >= 400) return res;

    const location = res.headers.get("location")?.trim();
    if (!location) return res;

    if (hop >= MAX_REDIRECT_HOPS) {
      await res.body?.cancel().catch(() => {});
      throw new Error("Too many redirects");
    }
    await res.body?.cancel().catch(() => {});

    const next = new URL(location, url);
    if (next.origin !== url.origin) {
      headers.delete("authorization");
      headers.delete("cookie");
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
