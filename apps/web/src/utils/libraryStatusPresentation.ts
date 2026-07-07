import type { LibraryMediaStatus } from "@rawkoon/shared/types";
import type { MediaPosterCardStatus } from "@/components/MediaPosterCard";

type LibraryStatusTone = "ok" | "progress" | "attention" | "meta" | "neutral";

export interface LibraryStatusPresentation {
  cardStatus: MediaPosterCardStatus;
  tone: LibraryStatusTone;
  liseretClass: string;
  badgeClass: string;
  showBadge: boolean;
  labelKey: string;
  quickAction: "search" | null;
}

const ATTENTION = {
  liseretClass: "bg-rose-400",
  badgeClass: "bg-rose-500/20 text-rose-300",
} as const;
const PROGRESS = {
  liseretClass: "bg-sky-400",
  badgeClass: "bg-sky-500/20 text-sky-300",
} as const;
const OK = {
  liseretClass: "bg-emerald-400",
  badgeClass: "bg-emerald-500/20 text-emerald-300",
} as const;
const RETURNING = {
  liseretClass: "bg-primary-400",
  badgeClass: "bg-primary-500/20 text-primary-300",
} as const;
const IN_PROD = {
  liseretClass: "bg-amber-400",
  badgeClass: "bg-amber-500/20 text-amber-300",
} as const;
const NEUTRAL = {
  liseretClass: "bg-neutral-400",
  badgeClass: "bg-neutral-700 text-neutral-300",
} as const;

export function libraryStatusPresentation(
  status: LibraryMediaStatus,
): LibraryStatusPresentation {
  const label = (s: string) => `medias.library.itemStatus.${s}`;
  switch (status) {
    case "downloaded":
      return {
        cardStatus: "downloaded",
        tone: "ok",
        ...OK,
        showBadge: false,
        labelKey: label("downloaded"),
        quickAction: null,
      };
    case "downloading":
      return {
        cardStatus: "downloading",
        tone: "progress",
        ...PROGRESS,
        showBadge: true,
        labelKey: label("downloading"),
        quickAction: null,
      };
    case "upgrading":
      return {
        cardStatus: "downloading",
        tone: "progress",
        ...PROGRESS,
        showBadge: true,
        labelKey: label("upgrading"),
        quickAction: null,
      };
    case "wanted":
      return {
        cardStatus: "missing",
        tone: "attention",
        ...ATTENTION,
        showBadge: true,
        labelKey: label("wanted"),
        quickAction: "search",
      };
    case "skipped":
      return {
        cardStatus: "missing",
        tone: "neutral",
        ...NEUTRAL,
        showBadge: false,
        labelKey: label("skipped"),
        quickAction: "search",
      };
    case "returning":
      return {
        cardStatus: "returning",
        tone: "meta",
        ...RETURNING,
        showBadge: false,
        labelKey: label("returning"),
        quickAction: null,
      };
    case "in_production":
      return {
        cardStatus: "in_production",
        tone: "meta",
        ...IN_PROD,
        showBadge: false,
        labelKey: label("in_production"),
        quickAction: null,
      };
    case "planned":
      return {
        cardStatus: "planned",
        tone: "neutral",
        ...NEUTRAL,
        showBadge: false,
        labelKey: label("planned"),
        quickAction: null,
      };
  }
}
