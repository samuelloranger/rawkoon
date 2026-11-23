import type { SearchResultPayload } from "@rawkoon/shared/types";
import { formatBytes } from "@/lib/utils/format";
import { formatReleaseDay } from "./addToastMessage";
import { languageFallbackMissMessage } from "./languageFallback";

type T = (key: string, options?: Record<string, unknown>) => string;

export type SearchToastAction = "view" | "changeRelease" | "grabNow" | "choose";

export interface SearchResultView {
  /** A miss is neutral; only a real failure is styled as an error. */
  variant: "success" | "info" | "error";
  message: string;
  /** Primary button, then an optional second one. */
  actions: SearchToastAction[];
}

export interface SearchResultViewContext {
  t: T;
  language: string;
  profileName: string | null;
  isShow: boolean;
}

const QUALITY_TOKEN =
  /\b(2160p|1080[pi]|720p|576p|480p|4K|UHD|WEB[-.]?DL|WEB[-.]?Rip|WEB|BluRay|BDRip|BDRemux|REMUX|HDTV|HDRip|DVDRip|MULTI|TRUEFRENCH|FRENCH|VFF|VFQ|VFI|VOF|VOQ)\b/i;

/** "Some.Movie.2024.1080p.WEB-DL-GRP" becomes "Some Movie 2024". */
export function shortReleaseTitle(title: string, max = 44): string {
  const cut = QUALITY_TOKEN.exec(title);
  const head = (cut ? title.slice(0, cut.index) : title)
    .replace(/[._]+/g, " ")
    .replace(/[\s-]+$/g, "")
    .trim();
  const text = head || title;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function qualityLine(
  release: NonNullable<SearchResultPayload["release"]>,
  language: string,
): string {
  const size =
    release.size_bytes != null && release.size_bytes > 0
      ? formatBytes(release.size_bytes, language)
      : null;
  return [
    release.resolution ? `${release.resolution}p` : null,
    release.source,
    size,
  ]
    .filter(Boolean)
    .join(" ");
}

function formatHeldUntil(iso: string | undefined, language: string): string {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  const sameDay = date.toDateString() === new Date().toDateString();
  return new Intl.DateTimeFormat(language, {
    timeStyle: "short",
    ...(sameDay ? {} : { dateStyle: "medium" }),
  }).format(date);
}

/** What the live toast says, and which buttons it offers, for a finished search. */
export function searchResultView(
  ctx: SearchResultViewContext,
  result: SearchResultPayload,
): SearchResultView {
  const { t, language } = ctx;
  switch (result.outcome) {
    case "grabbed": {
      const release = result.release;
      const quality = release ? qualityLine(release, language) : "";
      const name = release ? shortReleaseTitle(release.title) : "";
      return {
        variant: "success",
        message: !release
          ? t("medias.searchToast.grabbingHeld")
          : quality
            ? t("medias.searchToast.grabbing", { release: name, quality })
            : t("medias.searchToast.grabbingPlain", { release: name }),
        actions: ["view", "changeRelease"],
      };
    }
    case "delayed":
      return {
        variant: "info",
        message: t("medias.searchToast.held", {
          time: formatHeldUntil(result.delay_until, language),
        }),
        actions: ["grabNow"],
      };
    case "no_match": {
      const summary = result.language_fallback_summary;
      if (summary) {
        return {
          variant: "info",
          message: languageFallbackMissMessage(t, summary),
          actions: ["choose"],
        };
      }
      return {
        variant: "info",
        message: ctx.profileName
          ? t("medias.searchToast.noFit", { profile: ctx.profileName })
          : t("medias.searchToast.noRelease"),
        actions: ["choose"],
      };
    }
    case "not_released": {
      const date = result.delay_until
        ? formatReleaseDay(result.delay_until.slice(0, 10), language)
        : null;
      const base = ctx.isShow
        ? "medias.searchToast.notAiredYet"
        : "medias.searchToast.notReleased";
      return {
        variant: "info",
        message: date ? t(base, { date }) : t(`${base}NoDate`),
        actions: [],
      };
    }
    case "error":
      return {
        variant: "error",
        message: result.reason
          ? t("medias.searchToast.failedWithReason", { reason: result.reason })
          : t("medias.searchToast.failed"),
        actions: [],
      };
  }
}

/** Higher wins when a show's seasons report one after another. */
export function outcomeRank(outcome: SearchResultPayload["outcome"]): number {
  switch (outcome) {
    case "grabbed":
      return 4;
    case "delayed":
      return 3;
    case "no_match":
      return 2;
    case "not_released":
      return 1;
    case "error":
      return 0;
  }
}
