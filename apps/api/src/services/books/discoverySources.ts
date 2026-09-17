import type {
  BookDiscoveryList,
  BookDiscoverySourceId,
} from "@rawkoon/shared/types";
import {
  getPalmares,
  palmaresCoverUrl,
  type PalmaresTheme,
} from "@rawkoon/api/services/books/leslibrairesPalmares";
import { createNytSource } from "@rawkoon/api/services/books/nytBooksSource";

/** A ranked entry as a source produces it, before ISBN enrichment. */
export interface RankedEntry {
  rank: number;
  title: string;
  isbn13: string | null;
  coverUrl: string | null;
  sourceUrl: string | null;
  /** Filled only when the source itself supplies it (NYT does; leslibraires does not). */
  author: string | null;
  overview: string | null;
}

/**
 * A book-discovery source: a ranked list provider. Each source exposes one or
 * more named lists and fetches a list into `RankedEntry[]`. Enrichment,
 * caching, and library membership live above this in `bookDiscovery`, so a
 * source stays a pure ranking producer.
 */
export interface BookDiscoverySource {
  id: BookDiscoverySourceId;
  label: string;
  /** Whether the source is usable now (NYT needs an API key). */
  isConfigured(): Promise<boolean>;
  lists(): Promise<BookDiscoveryList[]>;
  fetch(listId: string): Promise<RankedEntry[]>;
}

const LESLIBRAIRES_LISTS: BookDiscoveryList[] = [
  { id: "general", label: "Palmarès" },
  { id: "jeunesse", label: "Jeunesse" },
];

const leslibrairesSource: BookDiscoverySource = {
  id: "leslibraires",
  label: "Palmarès Québec",
  isConfigured: async () => true,
  lists: async () => LESLIBRAIRES_LISTS,
  fetch: async (listId) => {
    const theme: PalmaresTheme = listId === "jeunesse" ? "jeunesse" : "general";
    const entries = await getPalmares(theme);
    return entries.map((e) => ({
      rank: e.rank,
      title: e.title,
      isbn13: e.isbn13,
      coverUrl: e.coverUrl ?? palmaresCoverUrl(e.isbn13),
      sourceUrl: e.url,
      author: null,
      overview: null,
    }));
  },
};

const SOURCES: BookDiscoverySource[] = [leslibrairesSource, createNytSource()];

export function listDiscoverySources(): BookDiscoverySource[] {
  return SOURCES;
}

export function getDiscoverySource(id: string): BookDiscoverySource | null {
  return SOURCES.find((s) => s.id === id) ?? null;
}
