import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useMediaModalData } from "@/features/medias/hooks/useMediaModalData";
import { seasonsFromTmdb, todayIso, type PlanSeason } from "./seasonPlan";

/** Season strip data for a show that is not in the library yet; `failed` when TMDB details can't supply it, so callers fall back to server defaults. */
export function useShowSeasons(tmdbId: number): {
  seasons: PlanSeason[] | undefined;
  failed: boolean;
} {
  const { i18n } = useTranslation("common");
  const { data, isError } = useMediaModalData(
    "tv",
    tmdbId,
    undefined,
    i18n.language,
  );
  const raw = data?.details?.seasons;
  const seasons = useMemo(
    () => (raw ? seasonsFromTmdb(raw, todayIso()) : undefined),
    [raw],
  );
  return {
    seasons,
    failed: isError || (data !== undefined && seasons === undefined),
  };
}
