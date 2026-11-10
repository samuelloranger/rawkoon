import {
  Bell,
  BookOpen,
  Boxes,
  Brain,
  Clapperboard,
  Clock,
  Download,
  Gauge,
  Globe,
  HeartPulse,
  Library,
  Plug2,
  Share2,
  ShieldBan,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";

export type SettingsGroup = "you" | "server" | "system";

export interface SettingsPageDef {
  id: string;
  group: SettingsGroup;
  path: string;
  titleKey: string;
  icon: LucideIcon;
  adminOnly: boolean;
  /** Extra search terms beyond the title (shared with the iPhone settings search). */
  keywords: string[];
}

const page = (
  id: string,
  group: SettingsGroup,
  icon: LucideIcon,
  keywords: string[],
): SettingsPageDef => ({
  id,
  group,
  path: `/settings/${id}`,
  titleKey: `settings.pages.${id}.title`,
  icon,
  adminOnly: group !== "you",
  keywords,
});

export const SETTINGS_PAGES: SettingsPageDef[] = [
  page("profile", "you", User, ["avatar", "name", "email", "account"]),
  page("security", "you", ShieldCheck, [
    "password",
    "passkey",
    "calendar",
    "subscription",
    "login",
    "devices",
  ]),
  page("alerts", "you", Bell, ["notifications", "push", "channels", "devices"]),
  page("app", "you", Smartphone, [
    "language",
    "navigation",
    "position",
    "appearance",
  ]),
  page("connections", "server", Plug2, [
    "tmdb",
    "the movie database",
    "metadata",
    "fanart",
    "artwork",
    "jellyfin",
    "media server",
    "prowlarr",
    "jackett",
    "indexer",
    "indexers",
    "search",
    "trackers",
    "torrent",
    "usenet",
    "download client",
    "qbittorrent",
    "transmission",
    "deluge",
    "download",
  ]),
  page("library", "server", Library, [
    "folders",
    "paths",
    "root",
    "media",
    "naming",
    "templates",
    "defaults",
    "profile",
    "grab",
    "auto",
    "automatic",
    "interval",
    "delay",
    "schedule",
    "cron",
    "check",
    "rss",
    "search on add",
  ]),
  page("quality", "server", SlidersHorizontal, [
    "quality",
    "profile",
    "resolution",
    "custom",
    "format",
    "scoring",
    "hdr",
  ]),
  page("after-download", "server", Share2, [
    "seeding",
    "seed",
    "ratio",
    "torrent",
    "release",
    "share",
    "sharing",
    "tracker",
    "extensions",
    "free space",
    "safety",
  ]),
  page("books", "server", BookOpen, [
    "audiobook",
    "ebook",
    "reading",
    "book quality profile",
    "audnexus",
    "audible",
    "open library",
    "providers",
  ]),
  page("people", "server", Users, [
    "accounts",
    "members",
    "admin",
    "invitations",
    "sessions",
    "login",
    "security",
    "api",
    "token",
    "keys",
    "access",
    "sso",
    "oidc",
    "single sign-on",
    "auth",
  ]),
  page("general", "server", Globe, ["country", "upcoming", "region", "app"]),
  page("ai", "server", Sparkles, [
    "llm",
    "recommendations",
    "provider",
    "model",
    "pricing",
  ]),
  page("health", "system", HeartPulse, [
    "readiness",
    "grab",
    "library health",
    "attention",
    "rss",
    "status",
    "diagnostics",
  ]),
  page("jobs", "system", Clock, ["tasks", "scheduled", "queue", "history"]),
  page("reencode", "system", Gauge, [
    "re-encode",
    "transcode",
    "hevc",
    "av1",
    "queue",
    "compress",
  ]),
  page("clips", "system", Clapperboard, [
    "preview",
    "clips",
    "trailer",
    "video",
    "backdrop",
  ]),
  page("downloads", "system", Download, [
    "import",
    "seeding",
    "orphans",
    "history",
    "radarr",
    "sonarr",
    "migrate",
  ]),
  page("blocklist", "system", ShieldBan, ["block", "banned", "releases"]),
  page("ai-usage", "system", Brain, [
    "ai",
    "usage",
    "cost",
    "budget",
    "history",
    "tokens",
  ]),
  page("updates", "system", Boxes, [
    "releases",
    "updates",
    "changelog",
    "version",
  ]),
];

export const SETTINGS_GROUPS: { id: SettingsGroup; labelKey: string }[] = [
  { id: "you", labelKey: "settings.groups.you" },
  { id: "server", labelKey: "settings.groups.server" },
  { id: "system", labelKey: "settings.groups.system" },
];

export function visibleSettingsPages(isAdmin: boolean): SettingsPageDef[] {
  return SETTINGS_PAGES.filter((p) => isAdmin || !p.adminOnly);
}

/** A page matches when the query is in its title or one of its keywords. */
export function matchesSettingsQuery(
  pageDef: SettingsPageDef,
  title: string,
  query: string,
  /** Comma-separated terms in the UI language, from the locale files. */
  localizedKeywords = "",
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    title.toLowerCase().includes(needle) ||
    localizedKeywords.toLowerCase().includes(needle) ||
    pageDef.keywords.some((k) => k.toLowerCase().includes(needle))
  );
}
