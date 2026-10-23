import i18n from "i18next";
import type { User } from "@rawkoon/shared/types";
import { isJellyfinPlaceholderEmail } from "@/lib/jellyfinEmail";

/** A Jellyfin placeholder address is not a name, so it falls through to the caller fallback. */
function nameFromEmail(email: string, fallback: string): string {
  return email && !isJellyfinPlaceholderEmail(email) ? email : fallback;
}

export function formatDisplayName(
  user: User | null | undefined,
  fallback: string = "",
): string {
  if (!user) return fallback;
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ");
  if (fullName && fullName.trim()) {
    return fullName
      .split(" ")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ");
  }
  return nameFromEmail(user.email, fallback);
}

export function getUserFirstName(
  user: User | null | undefined,
  fallback: string = "",
): string {
  if (!user) return fallback;
  if (user.first_name && user.first_name.trim()) {
    return (
      user.first_name.charAt(0).toUpperCase() +
      user.first_name.slice(1).toLowerCase()
    );
  }
  return nameFromEmail(user.email, fallback);
}

const SIZE_UNITS = {
  en: {
    byte: "byte",
    bytes: "bytes",
    zero: "Zero KB",
    units: ["KB", "MB", "GB", "TB", "PB"],
  },
  fr: {
    byte: "octet",
    bytes: "octets",
    zero: "Zéro Ko",
    units: ["Ko", "Mo", "Go", "To", "Po"],
  },
} as const;
/** Fraction digits per unit, from KB up, as Apple's adaptive file sizes use them. */
const SIZE_DIGITS = [0, 1, 2, 2, 2];

/**
 * Decimal file size, matching the iOS app (ByteCountFormatter, .file style):
 * 1 KB = 1000 bytes, "Zero KB", whole bytes below 1 KB, then 0/1/2 decimals
 * for KB/MB/GB+, trailing zeros dropped. Follows the UI language.
 */
export function formatBytes(
  bytes: number | null | undefined,
  language: string = i18n.resolvedLanguage ?? i18n.language ?? "en",
): string {
  const lang = language.startsWith("fr") ? "fr" : "en";
  const names = SIZE_UNITS[lang];
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return names.zero;
  if (bytes < 1000) {
    const n = Math.round(bytes);
    return `${n} ${n === 1 ? names.byte : names.bytes}`;
  }
  let index = Math.min(
    Math.floor(Math.log10(bytes) / 3) - 1,
    names.units.length - 1,
  );
  let value = bytes / 1000 ** (index + 1);
  // Rounding can carry into the next unit: 999,999 bytes shows as "1 MB".
  const factor = 10 ** SIZE_DIGITS[index];
  if (
    Math.round(value * factor) / factor >= 1000 &&
    index < names.units.length - 1
  ) {
    index += 1;
    value = bytes / 1000 ** (index + 1);
  }
  const number = new Intl.NumberFormat(lang === "fr" ? "fr-CA" : "en-CA", {
    maximumFractionDigits: SIZE_DIGITS[index],
    useGrouping: false,
  }).format(value);
  return `${number} ${names.units[index]}`;
}

export function formatSpeed(bytesPerSecond: number | null | undefined): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}
