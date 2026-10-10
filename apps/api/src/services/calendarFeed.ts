import { prisma } from "@rawkoon/api/db";
import {
  DEFAULT_TITLE_LANGUAGE,
  type TitleLanguage,
} from "@rawkoon/shared/constants";

const PAST_DAYS = 30;
const FUTURE_DAYS = 180;
const REFRESH_INTERVAL = "PT6H";
const DAY_MS = 24 * 60 * 60 * 1000;
const ON_DISK_STATUSES = new Set(["downloaded", "upgrading"]);

const LABELS: Record<
  TitleLanguage,
  { calendarName: string; digitalRelease: string; episodes: string }
> = {
  en: {
    calendarName: "Rawkoon",
    digitalRelease: "Digital release",
    episodes: "episodes",
  },
  fr: {
    calendarName: "Rawkoon",
    digitalRelease: "Sortie numérique",
    episodes: "épisodes",
  },
};

export type CalendarEvent = {
  uid: string;
  date: string;
  summary: string;
  description: string | null;
  url: string;
};

type MediaRow = {
  id: number;
  title: string;
  overview: string | null;
  overrides: unknown;
  titles: { language: string; title: string }[];
};

type EpisodeRow = {
  season: number;
  episode: number;
  title: string | null;
  status: string;
  airDate: Date | null;
  media: MediaRow;
};

type MovieRow = MediaRow & { status: string; digitalReleaseDate: Date | null };

/** Same precedence as the library list: manual override, then the locale's title, then the stored one. */
function displayTitle(media: MediaRow, language: TitleLanguage): string {
  const overrides = (media.overrides ?? {}) as Record<string, unknown>;
  if (typeof overrides.title === "string") return overrides.title;
  if (language !== DEFAULT_TITLE_LANGUAGE) {
    const localized = media.titles.find((t) => t.language === language);
    if (localized) return localized.title;
  }
  return media.title;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function episodeCode(season: number, episode: number): string {
  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}

function episodeLabel(
  group: EpisodeRow[],
  labels: (typeof LABELS)[TitleLanguage],
): string {
  const first = group[0];
  if (group.length === 1) {
    const code = episodeCode(first.season, first.episode);
    return first.title ? `${code} · ${first.title}` : code;
  }
  const last = group[group.length - 1];
  const end =
    last.season === first.season
      ? `E${String(last.episode).padStart(2, "0")}`
      : episodeCode(last.season, last.episode);
  return `${episodeCode(first.season, first.episode)}–${end} (${group.length} ${labels.episodes})`;
}

/** Turns library rows into one event per movie and one per show per air date. */
export function buildCalendarEvents(
  episodes: EpisodeRow[],
  movies: MovieRow[],
  language: TitleLanguage,
  baseUrl: string,
): CalendarEvent[] {
  const labels = LABELS[language];
  const base = baseUrl.replace(/\/+$/, "");
  const events: CalendarEvent[] = [];

  const groups = new Map<string, EpisodeRow[]>();
  for (const episode of episodes) {
    if (!episode.airDate) continue;
    const key = `${episode.media.id}:${isoDate(episode.airDate)}`;
    const group = groups.get(key);
    if (group) group.push(episode);
    else groups.set(key, [episode]);
  }

  for (const group of groups.values()) {
    group.sort((a, b) => a.season - b.season || a.episode - b.episode);
    const media = group[0].media;
    const date = isoDate(group[0].airDate as Date);
    const onDisk = group.every((e) => ON_DISK_STATUSES.has(e.status));
    events.push({
      uid: `tv-${media.id}-${date}@rawkoon`,
      date,
      summary: `${onDisk ? "✓ " : ""}${displayTitle(media, language)} — ${episodeLabel(group, labels)}`,
      description: media.overview,
      url: `${base}/library/${media.id}`,
    });
  }

  for (const movie of movies) {
    if (!movie.digitalReleaseDate) continue;
    const onDisk = ON_DISK_STATUSES.has(movie.status);
    events.push({
      uid: `movie-${movie.id}@rawkoon`,
      date: isoDate(movie.digitalReleaseDate),
      summary: `${onDisk ? "✓ " : ""}${displayTitle(movie, language)} — ${labels.digitalRelease}`,
      description: movie.overview,
      url: `${base}/library/${movie.id}`,
    });
  }

  return events.sort(
    (a, b) =>
      a.date.localeCompare(b.date) || a.summary.localeCompare(b.summary),
  );
}

function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** RFC 5545 folding: lines over 75 octets continue on the next line after a space, never splitting a character. */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  let currentBytes = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    const limit = parts.length === 0 ? 75 : 74;
    if (currentBytes + size > limit) {
      parts.push(current);
      current = "";
      currentBytes = 0;
    }
    current += char;
    currentBytes += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

function compactDate(date: string): string {
  return date.replace(/-/g, "");
}

function nextDay(date: string): string {
  return isoDate(new Date(Date.parse(`${date}T00:00:00Z`) + DAY_MS));
}

function utcStamp(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
}

export function renderCalendar(
  events: CalendarEvent[],
  language: TitleLanguage,
  now: Date,
): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Rawkoon//Library calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(LABELS[language].calendarName)}`,
    `REFRESH-INTERVAL;VALUE=DURATION:${REFRESH_INTERVAL}`,
    `X-PUBLISHED-TTL:${REFRESH_INTERVAL}`,
  ];
  const stamp = utcStamp(now);
  for (const event of events) {
    const description = [event.description, event.url]
      .filter(Boolean)
      .join("\n\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compactDate(event.date)}`,
      `DTEND;VALUE=DATE:${compactDate(nextDay(event.date))}`,
      `SUMMARY:${escapeText(event.summary)}`,
      `DESCRIPTION:${escapeText(description)}`,
      `URL:${event.url}`,
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

const mediaSelect = {
  id: true,
  title: true,
  overview: true,
  overrides: true,
  titles: { select: { language: true, title: true } },
} as const;

/** The whole monitored library from 30 days ago to 180 days ahead, as an .ics document. */
export async function buildLibraryCalendar(
  language: TitleLanguage,
  baseUrl: string,
  now: Date = new Date(),
): Promise<string> {
  const today = Date.parse(`${isoDate(now)}T00:00:00Z`);
  const from = new Date(today - PAST_DAYS * DAY_MS);
  const to = new Date(today + (FUTURE_DAYS + 1) * DAY_MS - 1);

  const [episodes, movies] = await Promise.all([
    prisma.libraryEpisode.findMany({
      where: {
        airDate: { gte: from, lte: to },
        monitored: true,
        media: { type: "show", monitored: true },
      },
      select: {
        season: true,
        episode: true,
        title: true,
        status: true,
        airDate: true,
        media: { select: mediaSelect },
      },
    }),
    prisma.libraryMedia.findMany({
      where: {
        type: "movie",
        monitored: true,
        digitalReleaseDate: { gte: from, lte: to },
      },
      select: { ...mediaSelect, status: true, digitalReleaseDate: true },
    }),
  ]);

  return renderCalendar(
    buildCalendarEvents(episodes, movies, language, baseUrl),
    language,
    now,
  );
}
