/**
 * Prowlarr /api/v1/search helpers for automated grabs (no in-memory download tokens).
 */

export const toRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export const toStringOrNull = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t ? t : null;
};

export const toNumberOrNull = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value))
    return Math.trunc(value);
  if (typeof value === "string" && value.trim()) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

export function extractProwlarrDownloadTarget(
  row: Record<string, unknown>,
  prowlarrBaseUrl: string,
): { url: string; isMagnet: boolean } | null {
  const magnet =
    toStringOrNull(row.magnetUrl) ||
    toStringOrNull(row.magnetUri) ||
    toStringOrNull(row.magnetLink) ||
    toStringOrNull(row.magnet);
  if (magnet?.startsWith("magnet:")) return { url: magnet, isMagnet: true };

  const dl =
    toStringOrNull(row.downloadUrl) ||
    toStringOrNull(row.download_link) ||
    toStringOrNull(row.link);
  if (!dl) return null;
  if (dl.startsWith("magnet:")) return { url: dl, isMagnet: true };
  if (dl.startsWith("http://") || dl.startsWith("https://"))
    return { url: dl, isMagnet: false };

  const base = prowlarrBaseUrl.replace(/\/+$/, "");
  const path = dl.startsWith("/") ? dl : `/${dl}`;
  return { url: `${base}${path}`, isMagnet: false };
}

export function infoHashFromMagnet(magnet: string): string | null {
  const m = /btih:([a-fA-F0-9]{40})/i.exec(magnet);
  return m ? m[1].toLowerCase() : null;
}

export function indexerNameFromRaw(
  row: Record<string, unknown>,
): string | null {
  const indexerRecord = toRecord(row.indexer);
  return (
    toStringOrNull(row.indexer) ||
    toStringOrNull(indexerRecord?.name) ||
    toStringOrNull(indexerRecord?.title)
  );
}

export function releaseTitleFromRaw(
  row: Record<string, unknown>,
): string | null {
  return toStringOrNull(row.title);
}

export function sizeBytesFromRaw(row: Record<string, unknown>): number | null {
  return toNumberOrNull(row.size);
}

export function toBoolean(value: unknown): boolean {
  return Boolean(value);
}
