export interface TrackerTagMatch {
  tag: string;
  label: string;
  host: string;
  url: string;
}

/**
 * Derive a stable tracker tag + display label from a tracker announce URL,
 * generically — no hardcoded tracker list. The registrable label (the
 * second-level domain, e.g. "example" in "tracker.example.com") becomes the
 * tag; the label is that name title-cased with `-`/`_` treated as spaces.
 */
export function mapTrackerUrlToTag(url: string): TrackerTagMatch | null {
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith("** [")) return null;

  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname
      .trim()
      .toLowerCase()
      .replace(/^www\./, "");
    if (!host) return null;

    const labels = host.split(".").filter(Boolean);
    if (labels.length === 0) return null;
    // Registrable name: the second-to-last label, or the sole label.
    const sld = labels.length >= 2 ? labels[labels.length - 2] : labels[0];
    if (!sld) return null;

    const label = sld
      .split(/[-_]/)
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");

    return {
      tag: sld,
      label,
      host,
      url: trimmed,
    };
  } catch {
    return null;
  }
}
