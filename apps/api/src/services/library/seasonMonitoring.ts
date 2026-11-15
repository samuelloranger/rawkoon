import { z } from "zod";
import { prisma } from "@rawkoon/api/db";
import type { SeasonMode } from "@rawkoon/shared/types";

export const seasonModeSchema = z.enum(["all", "future", "latest", "pick"]);

export type SeasonChoice = {
  seasonMode: SeasonMode;
  seasons?: number[];
};

type PlanEpisode = { id: number; season: number; airDate: Date | null };

/** Ids of the regular episodes a season choice monitors; specials are never picked. */
export function planMonitoredEpisodes(
  choice: SeasonChoice,
  episodes: PlanEpisode[],
  now: Date = new Date(),
): Set<number> {
  const regular = episodes.filter((e) => e.season > 0);
  const isFuture = (e: PlanEpisode) => e.airDate == null || e.airDate > now;
  let picked: PlanEpisode[];
  switch (choice.seasonMode) {
    case "all":
      picked = regular;
      break;
    case "future":
      picked = regular.filter(isFuture);
      break;
    case "latest": {
      // An announced season with nothing aired yet is not "latest"; its episodes are future anyway.
      const aired = regular.filter((e) => !isFuture(e));
      const latest = Math.max(0, ...aired.map((e) => e.season));
      picked = regular.filter((e) => e.season === latest || isFuture(e));
      break;
    }
    case "pick": {
      const wanted = new Set(choice.seasons ?? []);
      picked = regular.filter((e) => wanted.has(e.season));
      break;
    }
  }
  return new Set(picked.map((e) => e.id));
}

/** Sets every regular episode's monitored flag from a season choice. */
export async function applySeasonChoice(
  mediaId: number,
  choice: SeasonChoice,
): Promise<void> {
  const episodes = await prisma.libraryEpisode.findMany({
    where: { mediaId, season: { gt: 0 } },
    select: { id: true, season: true, airDate: true },
  });
  const ids = [...planMonitoredEpisodes(choice, episodes)];
  await prisma.libraryEpisode.updateMany({
    where: { mediaId, season: { gt: 0 }, id: { in: ids } },
    data: { monitored: true },
  });
  await prisma.libraryEpisode.updateMany({
    where: { mediaId, season: { gt: 0 }, id: { notIn: ids } },
    data: { monitored: false },
  });
}

/** "future" only makes sense when later seasons are monitored, so it forces the flag on. */
export function effectiveMonitorNewSeasons(
  mode: SeasonMode,
  monitorNewSeasons: boolean,
): boolean {
  return mode === "future" ? true : monitorNewSeasons;
}

export type ResolvedSeasonChoice = {
  choice: SeasonChoice;
  monitorNewSeasons: boolean;
};

type SeasonDefaults = {
  defaultSeasonMode?: string | null;
  defaultMonitorNewSeasons?: boolean | null;
} | null;

/**
 * Merges a client's season input over the settings defaults. Returns an error
 * message for input the API rejects: seasons without "pick", or "pick" with none.
 */
export function resolveSeasonChoice(
  input: {
    seasonMode?: SeasonMode | null;
    seasons?: number[] | null;
    monitorNewSeasons?: boolean | null;
  },
  settings: SeasonDefaults,
): ResolvedSeasonChoice | { error: string } {
  const seasons = input.seasons ?? undefined;
  if (input.seasonMode === "pick") {
    if (!seasons || seasons.length === 0) {
      return { error: "seasons must not be empty when season_mode is pick" };
    }
  } else if (seasons !== undefined) {
    return { error: "seasons is only valid when season_mode is pick" };
  }
  const defaultMode = (settings?.defaultSeasonMode ?? "all") as SeasonMode;
  const seasonMode = input.seasonMode ?? defaultMode;
  const monitorNewSeasons = effectiveMonitorNewSeasons(
    seasonMode,
    input.monitorNewSeasons ?? settings?.defaultMonitorNewSeasons ?? true,
  );
  return { choice: { seasonMode, seasons }, monitorNewSeasons };
}

/** "Manage seasons": re-plans episode monitoring and saves the new-season flag. */
export async function setMonitoredSeasons(
  mediaId: number,
  choice: SeasonChoice,
  monitorNewSeasons: boolean,
): Promise<boolean> {
  const stored = effectiveMonitorNewSeasons(
    choice.seasonMode,
    monitorNewSeasons,
  );
  await applySeasonChoice(mediaId, choice);
  await prisma.libraryMedia.update({
    where: { id: mediaId },
    data: { monitorNewSeasons: stored },
  });
  return stored;
}

/** The settings-backed form of resolveSeasonChoice, for callers that don't hold the settings row. */
export async function resolveSeasonChoiceWithSettings(
  input: Parameters<typeof resolveSeasonChoice>[0],
): Promise<ResolvedSeasonChoice | { error: string }> {
  const settings = await prisma.mediaSettings.findUnique({ where: { id: 1 } });
  return resolveSeasonChoice(input, settings);
}

/** Whether non-admins may pick seasons when requesting a show. */
export async function requestersMayChooseSeasons(): Promise<boolean> {
  const row = await prisma.mediaSettings.findUnique({
    where: { id: 1 },
    select: { requestersChooseSeasons: true },
  });
  return row?.requestersChooseSeasons ?? true;
}

/**
 * The season input an approval resolves: the admin's own, else the request's.
 * A request without a choice means every season, never the add-dialog default.
 */
export function approvalSeasonInput(
  req: { seasonMode: string | null; seasons: number[] },
  input: {
    seasonMode?: SeasonMode;
    seasons?: number[];
    monitorNewSeasons?: boolean;
  },
): Parameters<typeof resolveSeasonChoice>[0] {
  if (input.seasonMode !== undefined || input.seasons !== undefined) {
    // Seasons sent alone can only mean a pick.
    return {
      seasonMode: input.seasonMode ?? "pick",
      seasons: input.seasons,
      monitorNewSeasons: input.monitorNewSeasons,
    };
  }
  return {
    seasonMode: (req.seasonMode as SeasonMode | null) ?? "all",
    seasons: req.seasons.length > 0 ? req.seasons : undefined,
    monitorNewSeasons: input.monitorNewSeasons,
  };
}

/** The season choice an approval applies, merged over the settings defaults. */
export function resolveApprovalSeasons(
  req: Parameters<typeof approvalSeasonInput>[0],
  input: Parameters<typeof approvalSeasonInput>[1],
) {
  return resolveSeasonChoiceWithSettings(approvalSeasonInput(req, input));
}
