import type { AiTrigger, SearchResultPayload } from "@rawkoon/shared/types";
import {
  searchAndGrab,
  searchAndGrabWithTitleFallback,
  type SearchGrab,
  type SearchMiss,
} from "@rawkoon/api/services/mediaGrabber/mediaGrabberSearch";
import { resolveSearchTitles } from "@rawkoon/api/utils/medias/resolveSearchTitles";
import { isNoMissRefusal } from "@rawkoon/api/services/grab/grabRefusal";
import {
  publishSearchResult,
  searchResultFrom,
} from "@rawkoon/api/services/searchResult";

export type LibraryTarget =
  | { kind: "movie" }
  | { kind: "episode"; episodeId: number; season: number; episode: number }
  | { kind: "season"; season: number }
  /** A whole show; `completeSeasons` makes it a complete-series pack search. */
  | { kind: "show"; completeSeasons?: number[] };

export type SearchableMedia = {
  id: number;
  title: string;
  searchTitle: string | null;
  originalTitle: string | null;
  year?: number | null;
  qualityProfileId: number | null;
};

const pad2 = (n: number) => String(n).padStart(2, "0");

/** The one place the indexer query suffix is formatted. */
export function targetSuffix(
  media: Pick<SearchableMedia, "year">,
  target: LibraryTarget,
): string {
  switch (target.kind) {
    case "movie":
      return media.year ? ` ${media.year}` : "";
    case "episode":
      return ` S${pad2(target.season)}E${pad2(target.episode)}`;
    case "season":
      return ` S${pad2(target.season)}`;
    case "show":
      return "";
  }
}

export type LibraryTargetSearch = {
  result: SearchGrab | SearchMiss;
  payload: SearchResultPayload;
  /** True when a scheduled caller should spend a search attempt on this outcome. */
  countsAsMiss: boolean;
  /** A full disk or an active show grab: says nothing about the release. */
  blocked: boolean;
};

/**
 * Searches one library target and publishes the outcome.
 * `query` replaces the title search verbatim (manual searches).
 * `publish: false` leaves publishing to a caller that aggregates payloads,
 * and then the payload carries no season stamp (the caller adds its own).
 */
export async function searchLibraryTarget(
  media: SearchableMedia,
  target: LibraryTarget,
  opts: {
    trigger: AiTrigger;
    query?: string;
    isUpgrade?: boolean;
    publish?: boolean;
  },
): Promise<LibraryTargetSearch> {
  const mediaType = target.kind === "movie" ? "movie" : "tv";
  const episodeId = target.kind === "episode" ? target.episodeId : undefined;
  const season = target.kind === "season" ? target.season : undefined;
  const shared = {
    mediaId: media.id,
    episodeId,
    season,
    mediaType,
    qualityProfileId: media.qualityProfileId,
    trigger: opts.trigger,
  } as const;

  const result = opts.query
    ? await searchAndGrab({ ...shared, searchQuery: opts.query })
    : await searchAndGrabWithTitleFallback({
        ...shared,
        titleBaseQueries: resolveSearchTitles(media).queries,
        suffix: targetSuffix(media, target),
        completeSeasons:
          target.kind === "show" ? target.completeSeasons : undefined,
        isUpgrade: opts.isUpgrade,
      });

  const publish = opts.publish !== false;
  const payload = searchResultFrom(
    media.id,
    result,
    publish ? season : undefined,
  );
  // An episode outcome says nothing about the show as a whole, so it is not stored.
  if (publish) {
    await publishSearchResult(payload, { persist: target.kind !== "episode" });
  }

  const blocked = !result.grabbed && isNoMissRefusal(result.refusal);
  return {
    result,
    payload,
    blocked,
    countsAsMiss:
      !result.grabbed &&
      !result.delayed &&
      !blocked &&
      result.refusal !== "already_active",
  };
}
