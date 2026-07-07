/**
 * Parse the response from POST /api/v2/torrents/add. qBittorrent has shipped
 * two formats over the years and we have to accept both:
 *
 *   - Legacy (<= 4.x): plain-text body "Ok." on success, anything else = fail.
 *   - qBittorrent 5.x: JSON body
 *     `{ "added_torrent_ids": [..], "success_count": N, "pending_count": M,
 *        "failure_count": K }`.
 *
 * Returns success when EITHER the legacy "Ok." sentinel is present OR the
 * JSON shape reports `success_count > 0` (or has any `added_torrent_ids`).
 * On JSON.parse failure, logs the raw body length + first 32 bytes as hex so
 * HTTP framing / BOM / encoding issues are diagnosable from the logs.
 */
export function parseQbittorrentAddResponse(
  responseText: string,
): { ok: true } | { ok: false; error: string } {
  const trimmed = responseText.trim();
  if (/^ok\.?$/i.test(trimmed)) return { ok: true };
  try {
    const parsed = JSON.parse(trimmed) as {
      added_torrent_ids?: unknown;
      success_count?: unknown;
    };
    if (parsed && typeof parsed === "object") {
      const successCount =
        typeof parsed.success_count === "number" ? parsed.success_count : 0;
      const idCount = Array.isArray(parsed.added_torrent_ids)
        ? parsed.added_torrent_ids.length
        : 0;
      if (successCount > 0 || idCount > 0) return { ok: true };
    }
  } catch (e) {
    const hexPreview = Buffer.from(responseText.slice(0, 32), "utf8").toString(
      "hex",
    );
    console.warn(
      `[parseQbittorrentAddResponse] JSON.parse failed: len=${responseText.length} hex32=${hexPreview} err=${e instanceof Error ? e.message : String(e)}`,
    );
  }
  return { ok: false, error: trimmed };
}
