import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isBlockedForLanFetch } from "@rawkoon/api/utils/ssrf";

/**
 * Server-side .torrent fetch SSRF hardening: block loopback, link-local (cloud
 * metadata), multicast and reserved targets, while still allowing LAN indexer
 * URLs typical in homelab setups. Hostnames are resolved so a DNS name can't
 * smuggle in a blocked address.
 */
export async function isServerTorrentFetchUrlAllowed(
  urlString: string,
): Promise<boolean> {
  let u: URL;
  try {
    u = new URL(urlString);
  } catch {
    return false;
  }

  if (u.protocol !== "http:" && u.protocol !== "https:") return false;

  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost") return false;

  if (isIP(host)) return !isBlockedForLanFetch(host);

  try {
    const addresses = await lookup(host, { all: true });
    if (addresses.length === 0) return false;
    return addresses.every((a) => !isBlockedForLanFetch(a.address));
  } catch {
    return false;
  }
}

export class MagnetRedirectError extends Error {
  constructor(public readonly magnetUrl: string) {
    super("Redirect to magnet link");
    this.name = "MagnetRedirectError";
  }
}

/**
 * Follow redirects manually so each hop is checked against {@link isServerTorrentFetchUrlAllowed}
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
    if (!(await isServerTorrentFetchUrlAllowed(url))) {
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
