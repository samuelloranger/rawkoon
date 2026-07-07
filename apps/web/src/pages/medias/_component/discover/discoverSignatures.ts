import type { DiscoverFilters } from "./discoverTypes";

export type DiscoverScrollFields = Pick<
  DiscoverFilters,
  | "mediaType"
  | "providerId"
  | "genreId"
  | "sortBy"
  | "page"
  | "originalLanguage"
> & { lang: string };

/** Discover query identity excluding page (service, genre, sort, language, type, i18n). */
export function buildDiscoverFilterSignature(
  f: Omit<DiscoverScrollFields, "page">,
): string {
  return `${f.lang}|${f.mediaType}|${f.providerId}|${f.genreId}|${f.sortBy}|${f.originalLanguage ?? ""}`;
}

export function buildDiscoverGridKey(
  f: Pick<
    DiscoverFilters,
    | "mediaType"
    | "providerId"
    | "genreId"
    | "sortBy"
    | "page"
    | "originalLanguage"
  > & { dataPage: number | undefined },
): string {
  const page = f.dataPage ?? f.page;
  return `${f.mediaType}-${f.providerId}-${f.genreId}-${f.sortBy}-${f.originalLanguage}-${page}`;
}
