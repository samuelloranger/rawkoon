import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Plus, Search } from "lucide-react";
import { toast } from "sonner";
import type { LibraryListResponse, LibraryMedia } from "@rawkoon/shared/types";
import { useFetcher } from "@/lib/api/context";
import {
  LIBRARY_ENDPOINTS,
  MEDIAS_ENDPOINTS,
  SHELVES_ENDPOINTS,
} from "@/lib/endpoints";
import { queryKeys } from "@/lib/queryKeys";
import { useShelfMutation } from "./useShelfMutation";
import { Dialog } from "@/components/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** One result of the TMDB search, as `/api/medias/tmdb-search` answers it. */
type TmdbSearchItem = {
  tmdb_id: number;
  media_type: "movie" | "tv";
  title: string;
  release_year: number | null;
  poster_url: string | null;
  already_exists: boolean;
};

type Candidate = {
  key: string;
  tmdbId: number;
  type: "movie" | "show";
  title: string;
  year: number | null;
  posterUrl: string | null;
  inLibrary: boolean;
};

const fromLibrary = (item: LibraryMedia): Candidate => ({
  key: `library-${item.id}`,
  tmdbId: item.tmdb_id,
  type: item.type === "show" ? "show" : "movie",
  title: item.title,
  year: item.year,
  posterUrl: item.poster_url,
  inLibrary: true,
});

const fromTmdb = (item: TmdbSearchItem): Candidate => ({
  key: `tmdb-${item.media_type}-${item.tmdb_id}`,
  tmdbId: item.tmdb_id,
  type: item.media_type === "tv" ? "show" : "movie",
  title: item.title,
  year: item.release_year,
  posterUrl: item.poster_url,
  inLibrary: item.already_exists,
});

/**
 * Add titles to a shelf: search the library first, and TMDB for what the
 * library lacks, so a shelf can hold a title before it is requested.
 */
export function AddTitlesDialog({
  shelfId,
  onShelf,
  isOpen,
  onClose,
}: {
  shelfId: number;
  /** The titles the shelf already holds, so the dialog doesn't offer them twice. */
  onShelf: Array<{ tmdb_id: number; type: "movie" | "show" }>;
  isOpen: boolean;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation("common");
  const fetcher = useFetcher();
  const [query, setQuery] = useState("");
  const trimmed = query.trim();

  const language = (i18n.resolvedLanguage ?? i18n.language).split("-")[0];
  const library = useQuery({
    queryKey: queryKeys.shelfPicker.librarySearch(trimmed, language),
    queryFn: () =>
      fetcher<LibraryListResponse>(
        `${LIBRARY_ENDPOINTS.LIST}?page=1&limit=8&search=${encodeURIComponent(trimmed)}&sort_by=title&sort_dir=asc&title_language=${encodeURIComponent(language)}`,
      ),
    enabled: isOpen && trimmed.length >= 2,
  });

  const tmdb = useQuery({
    queryKey: queryKeys.shelfPicker.tmdbSearch(trimmed),
    queryFn: () =>
      fetcher<{ items: TmdbSearchItem[] }>(
        MEDIAS_ENDPOINTS.TMDB_SEARCH(trimmed, undefined, undefined),
      ),
    enabled: isOpen && trimmed.length >= 2,
  });

  const held = new Set(
    onShelf.map((entry) => `${entry.type}-${entry.tmdb_id}`),
  );
  const candidates = new Map<string, Candidate>();
  for (const item of library.data?.items ?? []) {
    const candidate = fromLibrary(item);
    candidates.set(`${candidate.type}-${candidate.tmdbId}`, candidate);
  }
  for (const item of tmdb.data?.items ?? []) {
    const candidate = fromTmdb(item);
    const key = `${candidate.type}-${candidate.tmdbId}`;
    if (!candidates.has(key)) candidates.set(key, candidate);
  }

  const add = useShelfMutation({
    shelfId,
    errorMessage: t("shelves.addError"),
    mutationFn: (candidate: Candidate) =>
      fetcher(SHELVES_ENDPOINTS.ENTRIES(shelfId), {
        method: "POST",
        body: {
          tmdb_id: candidate.tmdbId,
          type: candidate.type,
        },
      }),
    // A negative id marks the placeholder until the refetch brings the real entry
    apply: (shelf, candidate) => ({
      ...shelf,
      entry_count: shelf.entry_count + 1,
      entries: [
        ...shelf.entries,
        {
          id: -Date.now(),
          tmdb_id: candidate.tmdbId,
          type: candidate.type,
          season: null,
          title: candidate.title,
          year: candidate.year,
          poster_url: candidate.posterUrl,
          backdrop_url: null,
          group_label: null,
          position: shelf.entries.length,
          in_library: candidate.inLibrary,
          library_id: null,
          source: "manual",
          reason: null,
        },
      ],
    }),
  });

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={t("shelves.addTitles")}
      bodyScroll
    >
      <div className="space-y-4 px-1 pb-2 text-left">
        <div className="relative">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500"
          />
          <Input
            autoFocus
            value={query}
            placeholder={t("shelves.searchPlaceholder")}
            className="pl-9"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        {trimmed.length < 2 ? (
          <p className="py-6 text-center text-sm text-neutral-500">
            {t("shelves.searchHint")}
          </p>
        ) : candidates.size === 0 ? (
          <p className="py-6 text-center text-sm text-neutral-500">
            {library.isLoading || tmdb.isLoading
              ? t("shelves.searching")
              : t("shelves.noResults")}
          </p>
        ) : (
          <ul className="max-h-[50vh] space-y-1 overflow-y-auto pr-1">
            {[...candidates.values()].map((candidate) => (
              <li
                key={candidate.key}
                className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-neutral-800/60"
              >
                <div className="h-14 w-10 shrink-0 overflow-hidden rounded bg-neutral-800">
                  {candidate.posterUrl ? (
                    <img
                      src={candidate.posterUrl}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-neutral-100">
                    {candidate.title}
                  </p>
                  <p className="text-xs text-neutral-500">
                    {[candidate.year, t(`shelves.type.${candidate.type}`)]
                      .filter(Boolean)
                      .join(" · ")}
                    {candidate.inLibrary ? ` · ${t("shelves.inLibrary")}` : ""}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant={candidate.inLibrary ? "outline" : "secondary"}
                  disabled={held.has(`${candidate.type}-${candidate.tmdbId}`)}
                  onClick={() =>
                    add.mutate(candidate, {
                      onSuccess: () => toast.success(t("shelves.added")),
                    })
                  }
                  className={cn("shrink-0")}
                >
                  <Plus size={14} />
                  {held.has(`${candidate.type}-${candidate.tmdbId}`)
                    ? t("shelves.alreadyOnShelf")
                    : t("shelves.add")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
