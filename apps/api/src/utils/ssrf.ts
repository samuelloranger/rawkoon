import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export function isPrivateIP(ip: string): boolean {
  if (isIP(ip) === 4) {
    const parts = ip.split(".").map((x) => parseInt(x, 10));
    if (parts.length !== 4 || parts.some(isNaN)) return true;

    const [a, b] = parts;

    // 127.0.0.0/8 (loopback)
    if (a === 127) return true;

    // 10.0.0.0/8 (private)
    if (a === 10) return true;

    // 172.16.0.0/12 (private)
    if (a === 172 && b >= 16 && b <= 31) return true;

    // 192.168.0.0/16 (private)
    if (a === 192 && b === 168) return true;

    // 169.254.0.0/16 (link-local)
    if (a === 169 && b === 254) return true;

    // 100.64.0.0/10 (carrier-grade NAT, RFC 6598)
    if (a === 100 && b >= 64 && b <= 127) return true;

    // 0.0.0.0 (unspecified)
    if (a === 0) return true;

    return false;
  }

  if (isIP(ip) === 6) {
    const normalized = ip.toLowerCase();

    // Loopback
    if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true;

    // Unspecified
    if (normalized === "::" || normalized === "0:0:0:0:0:0:0:0") return true;

    // Link-local (fe80::/10)
    if (
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb")
    ) {
      return true;
    }

    // Unique Local (fc00::/7 -> fc00 to fdff)
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) {
      return true;
    }

    // IPv4-mapped IPv6 (::ffff:192.168.1.1 or similar)
    if (normalized.startsWith("::ffff:")) {
      const ipv4Part = ip.slice(7);
      return isPrivateIP(ipv4Part);
    }

    return false;
  }

  return true;
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

/**
 * SSRF-safe fetch. Resolves the target host once, rejects any private/local
 * address, then pins the connection to the validated IP so a DNS-rebinding
 * response can't swap in a private address between the check and the request
 * (the TOCTOU that plain `validateSafeUrl(url)` + `fetch(url)` leaves open,
 * since `fetch` re-resolves the hostname independently).
 *
 * TLS still validates against the original hostname via SNI (`tls.serverName`),
 * and the `Host` header preserves virtual-host routing now that we connect by IP.
 */
export async function safeFetch(
  urlStr: string,
  init?: RequestInit,
): Promise<Response> {
  const url = new URL(urlStr);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Invalid protocol: ${url.protocol}`);
  }

  const hostname = url.hostname;
  let pinnedIp: string;

  if (isIP(hostname)) {
    if (isPrivateIP(hostname)) {
      throw new Error(
        `Outbound URL target IP is blocked (private/local range): ${hostname}`,
      );
    }
    pinnedIp = hostname;
  } else {
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
    pinnedIp = addresses[0].address;
  }

  // Connect to the validated IP, keeping port/path/query intact.
  const pinnedUrl = new URL(url);
  pinnedUrl.hostname = isIP(pinnedIp) === 6 ? `[${pinnedIp}]` : pinnedIp;

  const headers = new Headers(init?.headers);
  if (!headers.has("host")) headers.set("Host", url.host);

  const pinnedInit: RequestInit & { tls?: { serverName?: string } } = {
    ...init,
    headers,
  };
  if (url.protocol === "https:") {
    const existingTls = (init as { tls?: Record<string, unknown> } | undefined)
      ?.tls;
    pinnedInit.tls = { ...existingTls, serverName: hostname };
  }

  return fetch(pinnedUrl.toString(), pinnedInit as RequestInit);
}
