import type { Variants } from "motion/react";
import type { SortOpt } from "./discoverTypes";

/** Must stay in sync with TMDB discover route `PAGE_SIZE` in `apps/api`. */
export const DISCOVER_PAGE_SIZE = 48;

export const DISCOVER_SORTS: SortOpt[] = [
  { value: "popularity.desc", labelKey: "medias.discover.sortPopularity" },
  { value: "vote_average.desc", labelKey: "medias.discover.sortTopRated" },
  {
    value: "primary_release_date.desc",
    labelKey: "medias.discover.sortNewest",
    movieOnly: true,
  },
  {
    value: "first_air_date.desc",
    labelKey: "medias.discover.sortNewest",
    tvOnly: true,
  },
  {
    value: "revenue.desc",
    labelKey: "medias.discover.sortRevenue",
    movieOnly: true,
  },
];

export const DISCOVER_LANGUAGE_FILTERS = [
  { code: "en", label: "EN" },
  { code: "fr", label: "FR" },
] as const;

export const discoverGridContainerVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.025 } },
};

export const discoverGridItemVariants: Variants = {
  hidden: { opacity: 0, scale: 0.95 },
  show: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] },
  },
};
