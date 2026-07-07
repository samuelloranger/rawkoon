import type {
  QbittorrentDashboardTorrent,
  QbittorrentTorrentListItem,
  QbittorrentTorrentProperties,
  QbittorrentTorrentPropertiesRaw,
  QbittorrentTorrentRaw,
} from "./clientTypes";

export const toRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export const toStringOrNull = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const toNumberOr = (value: unknown, fallback: number): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};

const toIsoDateOrNull = (value: unknown): string | null => {
  const seconds =
    typeof value === "number" && Number.isFinite(value)
      ? Math.trunc(value)
      : null;
  if (!seconds || seconds <= 0) return null;
  try {
    return new Date(seconds * 1000).toISOString();
  } catch {
    return null;
  }
};

const toTags = (value: unknown): string[] => {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 20);
};

export const toTorrent = (
  value: unknown,
): QbittorrentDashboardTorrent | null => {
  const row = toRecord(value) as QbittorrentTorrentRaw | null;
  if (!row) return null;

  const id = toStringOrNull(row.hash);
  const name = toStringOrNull(row.name);
  if (!id || !name) return null;

  const progressRaw = toNumberOr(row.progress, 0);
  const progress = Math.min(1, Math.max(0, progressRaw));
  const eta = Math.trunc(toNumberOr(row.eta, -1));
  const sizeBytes = Math.max(0, Math.trunc(toNumberOr(row.size, 0)));
  const state = toStringOrNull(row.state) || "unknown";

  return {
    id,
    name,
    progress,
    download_speed: Math.max(0, Math.trunc(toNumberOr(row.dlspeed, 0))),
    upload_speed: Math.max(0, Math.trunc(toNumberOr(row.upspeed, 0))),
    eta_seconds: eta >= 0 ? eta : null,
    size_bytes: sizeBytes,
    state,
    seeds: Math.max(0, Math.trunc(toNumberOr(row.num_seeds, 0))),
    peers: Math.max(0, Math.trunc(toNumberOr(row.num_leechs, 0))),
  };
};

export const toTorrentListItem = (
  value: unknown,
): QbittorrentTorrentListItem | null => {
  const base = toTorrent(value);
  if (!base) return null;
  const row = toRecord(value) as QbittorrentTorrentRaw | null;
  if (!row) return null;

  return {
    ...base,
    category: toStringOrNull(row.category),
    tags: toTags(row.tags),
    ratio:
      typeof row.ratio === "number" && Number.isFinite(row.ratio)
        ? row.ratio
        : null,
    added_on: toIsoDateOrNull(row.added_on),
    completed_on: toIsoDateOrNull(row.completed_on),
    content_path: toStringOrNull(row.content_path),
  };
};

export const toTorrentProperties = (
  value: unknown,
): QbittorrentTorrentProperties | null => {
  const row = toRecord(value) as QbittorrentTorrentPropertiesRaw | null;
  if (!row) return null;

  const toIntOrNull = (v: unknown): number | null => {
    if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
    if (typeof v === "string") {
      const parsed = Number(v);
      return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
    }
    return null;
  };

  const toFloatOrNull = (v: unknown): number | null => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const parsed = Number(v);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };

  return {
    save_path: toStringOrNull(row.save_path),
    total_size_bytes: toIntOrNull(row.total_size),
    piece_size_bytes: toIntOrNull(row.piece_size),
    comment: toStringOrNull(row.comment),
    creation_date: toIsoDateOrNull(row.creation_date),
    addition_date: toIsoDateOrNull(row.addition_date),
    completion_date: toIsoDateOrNull(row.completion_date),
    total_downloaded_bytes: toIntOrNull(row.total_downloaded),
    total_uploaded_bytes: toIntOrNull(row.total_uploaded),
    share_ratio: toFloatOrNull(row.share_ratio),
  };
};
