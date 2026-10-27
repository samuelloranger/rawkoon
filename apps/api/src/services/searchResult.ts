import { prisma } from "@rawkoon/api/db";
import type { SearchResultPayload } from "@rawkoon/shared/types";
import { emitSearchResult } from "@rawkoon/api/services/libraryEvents";
import { SPACE_REFUSAL_PREFIX } from "@rawkoon/api/services/grab/grabSpaceCheck";
import { NO_MATCH_REASON } from "@rawkoon/api/constants/libraryGrab";
import type {
  SearchGrab,
  SearchMiss,
} from "@rawkoon/api/services/mediaGrabber/mediaGrabberSearch";

/** Maps what the grabber returned onto the outcome clients show. */
export function searchResultFrom(
  mediaId: number,
  result: SearchGrab | SearchMiss,
  season?: number,
): SearchResultPayload {
  const base = { media_id: mediaId, ...(season != null ? { season } : {}) };
  if (result.grabbed) {
    return {
      ...base,
      outcome: "grabbed",
      release: {
        title: result.release?.title ?? result.releaseTitle,
        resolution: result.release?.resolution ?? null,
        source: result.release?.source ?? null,
        size_bytes: result.release?.sizeBytes ?? null,
      },
    };
  }
  if (result.delayed) {
    return {
      ...base,
      outcome: "delayed",
      ...(result.delayUntil
        ? { delay_until: result.delayUntil.toISOString() }
        : {}),
      ...(result.delayTargetKey ? { target_key: result.delayTargetKey } : {}),
    };
  }
  // Only an empty search is a normal miss; any other reason is a real failure.
  if (result.languageFallback != null || result.reason === NO_MATCH_REASON) {
    return {
      ...base,
      outcome: "no_match",
      reason: result.reason,
      ...(result.languageFallback
        ? { language_fallback_summary: result.languageFallback }
        : {}),
    };
  }
  console.warn(`[searchResult] Search failed for ${mediaId}: ${result.reason}`);
  return { ...base, outcome: "error", reason: safeErrorReason(result.reason) };
}

/** Raw reasons can carry indexer or client details; clients only see these fixed ones. */
export function safeErrorReason(raw: string): string {
  if (raw.startsWith(SPACE_REFUSAL_PREFIX)) return "Not enough free disk space";
  if (raw.startsWith("No indexer manager")) return "No indexer is configured";
  if (raw.startsWith("No download client"))
    return "No download client is configured";
  return GENERIC_ERROR_REASON;
}

export const GENERIC_ERROR_REASON = "The search failed";

/** Releases are due on this day; the item waits until then. */
export function notReleasedResult(
  mediaId: number,
  digitalReleaseDate: Date | null,
  season?: number,
): SearchResultPayload {
  return {
    media_id: mediaId,
    ...(season != null ? { season } : {}),
    outcome: "not_released",
    ...(digitalReleaseDate
      ? { delay_until: digitalReleaseDate.toISOString() }
      : {}),
  };
}

/**
 * Stores the outcome on the item so a miss outlives its toast, then pushes it
 * to connected clients. Never throws: a failed bookkeeping write must not fail the search.
 */
export async function publishSearchResult(
  payload: SearchResultPayload,
  opts: { persist?: boolean } = {},
): Promise<void> {
  if (opts.persist !== false) {
    try {
      await prisma.libraryMedia.update({
        where: { id: payload.media_id },
        data: {
          lastSearchAt: new Date(),
          lastSearchOutcome: payload.outcome,
          lastSearchReason:
            payload.outcome === "no_match" || payload.outcome === "error"
              ? (payload.reason ?? null)
              : null,
        },
      });
    } catch (e) {
      console.warn(
        `[searchResult] Could not store outcome for ${payload.media_id}:`,
        e,
      );
    }
  }
  emitSearchResult(payload);
}
