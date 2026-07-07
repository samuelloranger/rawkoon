import type { User } from "@rawkoon/shared/types";

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
  return user.email || fallback;
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
  return user.email || fallback;
}

export function formatCronTrigger(
  trigger: string,
  language: string = "en",
): string {
  const minuteMatch = trigger.match(/minute=['"]([^'"]+)['"]/);
  const hourMatch = trigger.match(/hour=['"]([^'"]+)['"]/);
  const dayMatch = trigger.match(/day=['"]([^'"]+)['"]/);
  const monthMatch = trigger.match(/month=['"]([^'"]+)['"]/);

  const minute = minuteMatch ? minuteMatch[1] : null;
  const hour = hourMatch ? hourMatch[1] : null;
  const day = dayMatch ? dayMatch[1] : null;
  const month = monthMatch ? monthMatch[1] : null;

  if (minute && minute.startsWith("*/")) {
    const interval = minute.substring(2);
    return language === "fr"
      ? `à tous les ${interval} minutes`
      : `every ${interval} minutes`;
  }

  if (hour && minute && day === "1" && (month === "*" || !month)) {
    const hourNum = parseInt(hour, 10);
    const minuteNum = parseInt(minute, 10);

    if (language === "fr") {
      return hourNum === 0 && minuteNum === 0
        ? "à minuit le 1er de chaque mois"
        : `à ${hourNum}h le 1er de chaque mois`;
    }

    if (hourNum === 0 && minuteNum === 0) {
      return "at midnight on the 1st of each month";
    }
    const hour12 = hourNum === 0 ? 12 : hourNum > 12 ? hourNum - 12 : hourNum;
    const ampm = hourNum < 12 ? "AM" : "PM";
    return `at ${hour12}:${minute.toString().padStart(2, "0")} ${ampm} on the 1st of each month`;
  }

  if (hour && minute) {
    const hourNum = parseInt(hour, 10);
    const minuteNum = parseInt(minute, 10);

    if (language === "fr") {
      return hourNum === 0 && minuteNum === 0
        ? "à minuit à tous les jours"
        : `à ${hourNum}h à tous les jours`;
    }

    if (hourNum === 0 && minuteNum === 0) {
      return "at midnight daily";
    }
    const hour12 = hourNum === 0 ? 12 : hourNum > 12 ? hourNum - 12 : hourNum;
    const ampm = hourNum < 12 ? "AM" : "PM";
    return `at ${hour12}:${minute.toString().padStart(2, "0")} ${ampm} daily`;
  }

  return trigger;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const power = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** power;
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[power]}`;
}

export function formatSpeed(bytesPerSecond: number | null | undefined): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}
