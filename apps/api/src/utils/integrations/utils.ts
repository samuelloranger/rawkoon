import type { ArrProfile } from "@rawkoon/shared/types";
export const normalizeUrl = (value: string): string =>
  value.trim().replace(/\/+$/, "");

export const isValidHttpUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

export const isPrivateUrl = (value: string): boolean => {
  try {
    const { hostname } = new URL(value);

    // Loopback
    if (hostname === "localhost" || hostname === "::1") return true;
    if (/^127\./.test(hostname)) return true;

    // Special
    if (hostname === "0.0.0.0") return true;

    // Link-local (IPv4 169.254.x.x and IPv6 fe80::)
    if (/^169\.254\./.test(hostname)) return true;
    if (/^fe80:/i.test(hostname)) return true;

    // RFC-1918
    if (/^10\./.test(hostname)) return true;
    if (/^192\.168\./.test(hostname)) return true;
    const m = hostname.match(/^172\.(\d+)\./);
    if (m && parseInt(m[1], 10) >= 16 && parseInt(m[1], 10) <= 31) return true;

    return false;
  } catch {
    return false;
  }
};

export const toProfiles = (value: unknown): ArrProfile[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry))
        return null;
      const raw = entry as Record<string, unknown>;
      const id =
        typeof raw.id === "number"
          ? Math.trunc(raw.id)
          : typeof raw.id === "string"
            ? parseInt(raw.id, 10)
            : Number.NaN;
      const name = typeof raw.name === "string" ? raw.name.trim() : "";
      if (!Number.isFinite(id) || id <= 0 || !name) return null;
      return { id, name };
    })
    .filter((entry): entry is ArrProfile => Boolean(entry));
};

export const clampInteger = (
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number => {
  const parsed =
    typeof value === "number"
      ? Math.trunc(value)
      : typeof value === "string"
        ? parseInt(value, 10)
        : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};
