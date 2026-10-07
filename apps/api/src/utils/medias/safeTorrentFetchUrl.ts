import { resolvePinnedIp, safeFetch } from "@rawkoon/api/utils/ssrf";

/**
 * Server-side .torrent fetch SSRF hardening: block loopback, link-local (cloud
 * metadata), multicast and reserved targets, while still allowing LAN indexer
 * URLs typical in homelab setups. Hostnames are resolved so a DNS name can't
 * smuggle in a blocked address.
 */
export async function isServerTorrentFetchUrlAllowed(
  urlString: string,
): Promise<boolean> {
  try {
    await resolvePinnedIp(new URL(urlString), "lan");
    return true;
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
 * Fetch a .torrent URL through {@link safeFetch} under the LAN policy: every
 * redirect hop is re-validated and IP-pinned, and credentials such as an
 * indexer API key are dropped once a hop leaves the original origin.
 * Throws {@link MagnetRedirectError} if a redirect target is a magnet link.
 */
export async function fetchHttpWithSafeRedirects(
  initialUrl: string,
  init: Omit<RequestInit, "redirect"> & { maxRedirects?: number },
): Promise<Response> {
  const { maxRedirects = 5, ...reqInit } = init;
  return safeFetch(initialUrl, reqInit, {
    policy: "lan",
    maxRedirects,
    onRedirect: (next) => {
      if (next.protocol === "magnet:") throw new MagnetRedirectError(next.href);
    },
  });
}
