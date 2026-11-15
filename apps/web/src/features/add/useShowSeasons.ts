import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useMediaModalData } from "@/features/medias/hooks/useMediaModalData";
import { seasonsFromTmdb, todayIso, type PlanSeason } from "./seasonPlan";

/** Season strip data for a show that is not in the library yet; undefined while TMDB details load. */
export function useShowSeasons(tmdbId: number): PlanSeason[] | undefined {
  const { i18n } = useTranslation("common");
  const { data } = useMediaModalData("tv", tmdbId, undefined, i18n.language);
  const seasons = data?.details?.seasons;
  return useMemo(
    () => (seasons ? seasonsFromTmdb(seasons, todayIso()) : undefined),
    [seasons],
  );
}
