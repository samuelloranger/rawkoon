import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { toast } from "sonner";
import type { LibraryMedia } from "@rawkoon/shared/types";
import { useFetcher } from "@/lib/api/context";
import { MEDIAS_ENDPOINTS, SHELVES_ENDPOINTS } from "@/lib/endpoints";
import { queryKeys } from "@/lib/queryKeys";
import { useInfiniteLibrary } from "@/features/medias/hooks/useInfiniteLibrary";
import { Dialog } from "@/components/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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

type TypeFilter = "" | "movie" | "show";

const keyOf = (type: string, tmdbId: number) => `${type}-${tmdbId}`;

const fromLibrary = (item: LibraryMedia): Candidate => {
  const type = item.type === "show" ? "show" : "movie";
  return {
    key: keyOf(type, item.tmdb_id),
    tmdbId: item.tmdb_id,
    type,
    title: item.title,
    year: item.year,
    posterUrl: item.poster_url,
    inLibrary: true,
  };
};

const fromTmdb = (item: TmdbSearchItem): Candidate => {
  const type = item.media_type === "tv" ? "show" : "movie";
  return {
    key: keyOf(type, item.tmdb_id),
    tmdbId: item.tmdb_id,
    type,
    title: item.title,
    year: item.release_year,
    posterUrl: item.poster_url,
    inLibrary: item.already_exists,
  };
};

/**
 * Add titles to a shelf: the whole library to scroll and tick, narrowed by a
 * search that also looks on TMDB for what the library lacks, then one OK.
 */
export function AddTitlesDialog({
  shelfId,
  onShelf,
  isOpen,
  onClose,
}: {
  shelfId: number;
  /** The titles the shelf already holds, shown ticked and locked. */
  onShelf: Array<{ tmdb_id: number; type: "movie" | "show" }>;
  isOpen: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation("common");
  const fetcher = useFetcher();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [type, setType] = useState<TypeFilter>("");
  const [selected, setSelected] = useState(() => new Map<string, Candidate>());
  const trimmed = query.trim();

  const library = useInfiniteLibrary(
    {
      type: type || undefined,
      q: trimmed || undefined,
      sortBy: "title",
      sortDir: "asc",
    },
    { enabled: isOpen },
  );

  // TMDB only for a real search, and only for what the library doesn't have
  const tmdb = useQuery({
    queryKey: queryKeys.shelfPicker.tmdbSearch(trimmed),
    queryFn: () =>
      fetcher<{ items: TmdbSearchItem[] }>(
        MEDIAS_ENDPOINTS.TMDB_SEARCH(trimmed, undefined, undefined),
      ),
    enabled: isOpen && trimmed.length >= 2,
  });

  const held = new Set(
    onShelf.map((entry) => keyOf(entry.type, entry.tmdb_id)),
  );
  const owned = (library.data?.pages ?? [])
    .flatMap((page) => page.items)
    .map(fromLibrary);
  const ownedKeys = new Set(owned.map((candidate) => candidate.key));
  const elsewhere = (trimmed.length >= 2 ? (tmdb.data?.items ?? []) : [])
    .map(fromTmdb)
    .filter(
      (candidate) =>
        !candidate.inLibrary &&
        !ownedKeys.has(candidate.key) &&
        (!type || candidate.type === type),
    );

  const toggle = (candidate: Candidate) =>
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(candidate.key)) next.delete(candidate.key);
      else next.set(candidate.key, candidate);
      return next;
    });

  const close = () => {
    setSelected(new Map());
    setQuery("");
    setType("");
    onClose();
  };

  // One POST per title, in the order they were ticked; the shelf is read again once at the end
  const addAll = useMutation({
    mutationFn: async (candidates: Candidate[]) => {
      const failed: Candidate[] = [];
      for (const candidate of candidates) {
        try {
          await fetcher(SHELVES_ENDPOINTS.ENTRIES(shelfId), {
            method: "POST",
            body: { tmdb_id: candidate.tmdbId, type: candidate.type },
          });
        } catch {
          failed.push(candidate);
        }
      }
      return { added: candidates.length - failed.length, failed };
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.shelves.all }),
    onSuccess: ({ added, failed }) => {
      if (added) toast.success(t("shelves.addedCount", { count: added }));
      if (!failed.length) return close();
      toast.error(t("shelves.addFailedCount", { count: failed.length }));
      // Only the titles that failed stay ticked, so OK retries just those
      setSelected(new Map(failed.map((c) => [c.key, c])));
    },
  });

  const onScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    if (
      el.scrollHeight - el.scrollTop - el.clientHeight < 400 &&
      library.hasNextPage &&
      !library.isFetchingNextPage
    ) {
      void library.fetchNextPage();
    }
  };

  const row = (candidate: Candidate) => {
    const onIt = held.has(candidate.key);
    return (
      <li key={candidate.key}>
        <label
          className={cn(
            "flex items-center gap-3 rounded-lg px-2 py-1.5",
            onIt ? "opacity-60" : "cursor-pointer hover:bg-neutral-800/60",
          )}
        >
          <Checkbox
            checked={onIt || selected.has(candidate.key)}
            disabled={onIt}
            onChange={() => toggle(candidate)}
            aria-label={candidate.title}
          />
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
              {onIt ? ` · ${t("shelves.alreadyOnShelf")}` : ""}
            </p>
          </div>
        </label>
      </li>
    );
  };

  const count = selected.size;
  const filters: Array<[TypeFilter, string]> = [
    ["", t("shelves.pickerAll")],
    ["movie", t("shelves.pickerMovies")],
    ["show", t("shelves.pickerShows")],
  ];

  return (
    <Dialog
      isOpen={isOpen}
      onClose={() => {
        if (!addAll.isPending) close();
      }}
      title={t("shelves.addTitles")}
      bodyScroll
    >
      <div className="flex min-h-0 flex-col gap-3 px-1 pb-1 text-left">
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
        <div role="group" className="flex gap-1.5">
          {filters.map(([value, label]) => (
            <button
              key={value || "all"}
              type="button"
              aria-pressed={type === value}
              onClick={() => setType(value)}
              className={cn(
                "focus-ring min-h-8 rounded-full border px-3 text-xs",
                type === value
                  ? "border-primary-400 bg-primary-500/20 text-neutral-100"
                  : "border-neutral-700 text-neutral-400 hover:text-neutral-200",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div
          className="max-h-[55vh] min-h-48 overflow-y-auto pr-1"
          onScroll={onScroll}
        >
          {owned.length === 0 && elsewhere.length === 0 ? (
            <p className="py-6 text-center text-sm text-neutral-500">
              {library.isLoading || tmdb.isFetching
                ? t("shelves.searching")
                : t("shelves.noResults")}
            </p>
          ) : (
            <>
              <ul className="space-y-0.5">{owned.map(row)}</ul>
              {library.isFetchingNextPage && (
                <p className="py-3 text-center text-xs text-neutral-500">
                  {t("shelves.searching")}
                </p>
              )}
              {elsewhere.length > 0 && (
                <>
                  <h3 className="mt-4 px-2 pb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
                    {t("shelves.notInLibrarySection")}
                  </h3>
                  <ul className="space-y-0.5">{elsewhere.map(row)}</ul>
                </>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-neutral-800 pt-3">
          <span className="text-xs text-neutral-500">
            {t("shelves.selectedCount", { count })}
          </span>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={addAll.isPending}
              onClick={close}
            >
              {t("common.cancel")}
            </Button>
            <Button
              size="sm"
              disabled={count === 0 || addAll.isPending}
              onClick={() => addAll.mutate([...selected.values()])}
            >
              {t("shelves.addSelected", { count })}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
