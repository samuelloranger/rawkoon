import { getDateYear } from "@rawkoon/shared/utils/date";
import type {
  DashboardUpcomingItem,
  TmdbMediaSearchItem,
} from "@rawkoon/shared/types";

export function parseCalendarSearchDate(dateStr?: string): Date | null {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return null;
  }

  const [year, month, day] = dateStr.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);

  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }

  return parsed;
}

export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function upcomingToDialogItem(
  item: DashboardUpcomingItem,
): TmdbMediaSearchItem {
  const [source, numericPart] = item.id.split("-", 2);
  const tmdbId =
    source === "movie" || source === "tv"
      ? parseInt(numericPart || "", 10)
      : Number.NaN;
  return {
    id: item.id,
    tmdb_id: Number.isFinite(tmdbId) ? tmdbId : 0,
    media_type: item.media_type,
    title: item.title,
    release_year: getDateYear(item.release_date),
    poster_url: item.poster_url,
    overview: item.overview,
    vote_average: item.vote_average ?? null,
    already_exists: item.library_id != null,
    can_add: item.library_id == null && Number.isFinite(tmdbId) && tmdbId > 0,
    source_id: null,
    library_id: item.library_id,
  };
}
