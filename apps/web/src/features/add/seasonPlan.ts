import type {
  LibraryEpisodesResponse,
  SeasonMode,
  TmdbSeasonSummary,
} from "@rawkoon/shared/types";

/** One regular season as the strip draws it: a bar per episode, or a dashed box while only announced. */
export interface PlanSeason {
  number: number;
  year: number | null;
  /** `future` = not aired yet (or no date). */
  episodes: { future: boolean }[];
  announced: boolean;
}

export interface SeasonChoice {
  mode: SeasonMode;
  picked: number[];
  newSeasons: boolean;
}

export const DEFAULT_CHOICE: SeasonChoice = {
  mode: "all",
  picked: [],
  newSeasons: true,
};

/** YYYY-MM-DD in local time, comparable as a string with TMDB dates. */
export function todayIso(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

const yearOf = (iso: string | null) => (iso ? Number(iso.slice(0, 4)) : null);

/** Before a show is in the library only the season summary is known, so a started season counts as fully aired. */
export function seasonsFromTmdb(
  seasons: TmdbSeasonSummary[],
  today: string,
): PlanSeason[] {
  return seasons
    .filter((s) => s.season_number > 0)
    .sort((a, b) => a.season_number - b.season_number)
    .map((s) => {
      const started = s.air_date != null && s.air_date <= today;
      return {
        number: s.season_number,
        year: yearOf(s.air_date),
        episodes: started
          ? Array.from({ length: s.episode_count ?? 0 }, () => ({
              future: false,
            }))
          : [],
        announced: !started,
      };
    });
}

/** Library episodes carry real air dates, so the unaired tail of the current season shows. */
export function seasonsFromEpisodes(
  data: LibraryEpisodesResponse,
  today: string,
): PlanSeason[] {
  return data.seasons
    .filter((s) => s.season > 0)
    .sort((a, b) => a.season - b.season)
    .map((s) => {
      const eps = [...s.episodes].sort((a, b) => a.episode - b.episode);
      const flags = eps.map((e) => ({
        future: e.air_date == null || e.air_date > today,
      }));
      const dates = eps.map((e) => e.air_date).filter((d) => d != null);
      return {
        number: s.season,
        year: yearOf(dates.sort()[0] ?? null),
        episodes: flags.some((f) => !f.future) ? flags : [],
        announced: !flags.some((f) => !f.future),
      };
    });
}

/** Most recent season with at least one aired episode; an announced season never counts. */
export function latestSeason(seasons: PlanSeason[]): number | null {
  const aired = seasons.filter((s) => s.episodes.some((e) => !e.future));
  return aired.length ? Math.max(...aired.map((s) => s.number)) : null;
}

/** "Future episodes only" always keeps new seasons on. */
export function wantsNewSeasons(choice: SeasonChoice): boolean {
  return choice.mode === "future" || choice.newSeasons;
}

/** Per-episode on/off for one season under a choice. */
export function episodeFlags(
  season: PlanSeason,
  choice: SeasonChoice,
  latest: number | null,
): { future: boolean; on: boolean }[] {
  return season.episodes.map((e) => ({
    future: e.future,
    on:
      choice.mode === "all"
        ? true
        : choice.mode === "future"
          ? e.future
          : choice.mode === "latest"
            ? season.number === latest || e.future
            : choice.picked.includes(season.number),
  }));
}

export interface PlanSummary {
  episodes: number;
  seasons: number[];
  newSeasons: boolean;
}

export function planSummary(
  seasons: PlanSeason[],
  choice: SeasonChoice,
): PlanSummary {
  const latest = latestSeason(seasons);
  let episodes = 0;
  const lit: number[] = [];
  for (const s of seasons) {
    const count = episodeFlags(s, choice, latest).filter((e) => e.on).length;
    if (count > 0) {
      episodes += count;
      lit.push(s.number);
    }
  }
  return { episodes, seasons: lit, newSeasons: wantsNewSeasons(choice) };
}

/** "1–5" for a run, "1, 3" otherwise. */
export function formatSeasonList(numbers: number[]): string {
  const sorted = [...numbers].sort((a, b) => a - b);
  const run =
    sorted.length > 1 &&
    sorted.every((n, i) => i === 0 || n === sorted[i - 1] + 1);
  return run ? `${sorted[0]}–${sorted[sorted.length - 1]}` : sorted.join(", ");
}

/** Body fields for POST /api/library and the approve and manage-seasons routes. */
export function choiceToBody(choice: SeasonChoice) {
  return {
    season_mode: choice.mode,
    ...(choice.mode === "pick" ? { seasons: choice.picked } : {}),
    monitor_new_seasons: wantsNewSeasons(choice),
  };
}

/** A pick with nothing picked can't be sent. */
export function isChoiceValid(choice: SeasonChoice): boolean {
  return choice.mode !== "pick" || choice.picked.length > 0;
}
