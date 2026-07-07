/**
 * Server-side .torrent fetch SSRF hardening: block loopback and cloud metadata,
 * while still allowing LAN indexer URLs typical in homelab setups.
 */
export function isHttpUrlSafeForServerTorrentFetch(urlString: string): boolean {
  let u: URL;
  try {
    u = new URL(urlString);
  } catch {
    return false;
  }

  if (u.protocol !== "http:" && u.protocol !== "https:") return false;

  const host = u.hostname.toLowerCase();

  if (host === "localhost" || host === "0.0.0.0") return false;
  if (host === "::1" || host === "[::1]") return false;

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const [, a, b] = ipv4;
    const ai = Number(a);
    const bi = Number(b);
    if (ai === 127) return false; // loopback 127.x.x.x
    if (ai === 0) return false; // 0.x.x.x
    // Block the entire link-local range (169.254.0.0/16) — covers cloud metadata
    // endpoints (AWS 169.254.169.254, GCP 169.254.169.254/metadata, etc.)
    if (ai === 169 && bi === 254) return false;
  }

  return true;
}

export class MagnetRedirectError extends Error {
  constructor(public readonly magnetUrl: string) {
    super("Redirect to magnet link");
    this.name = "MagnetRedirectError";
  }
}

/**
 * Follow redirects manually so each hop is checked against {@link isHttpUrlSafeForServerTorrentFetch}
 * (mitigates open redirects pointing at loopback/metadata).
 * Throws {@link MagnetRedirectError} if a redirect target is a magnet link.
 */
export async function fetchHttpWithSafeRedirects(
  initialUrl: string,
  init: Omit<RequestInit, "redirect"> & { maxRedirects?: number },
): Promise<Response> {
  const { maxRedirects = 5, ...reqInit } = init;
  const max = maxRedirects;
  let url = initialUrl;

  for (let i = 0; i <= max; i++) {
    if (!isHttpUrlSafeForServerTorrentFetch(url)) {
      throw new Error("URL not allowed");
    }
    const res = await fetch(url, { ...reqInit, redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc?.trim()) throw new Error("Redirect without Location");
      const next = new URL(loc.trim(), url).href;
      if (next.startsWith("magnet:")) {
        throw new MagnetRedirectError(next);
      }
      url = next;
      continue;
    }
    return res;
  }
  throw new Error("Too many redirects");
}
