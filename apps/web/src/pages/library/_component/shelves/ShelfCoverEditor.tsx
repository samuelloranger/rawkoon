import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ImagePlus, Search } from "lucide-react";
import { toast } from "sonner";
import type {
  ShelfCoverStyle,
  ShelfDetail,
  ShelfEntryView,
} from "@rawkoon/shared/types";
import { useFetcher } from "@/lib/api/context";
import { MEDIAS_ENDPOINTS, SHELVES_ENDPOINTS } from "@/lib/endpoints";
import { queryKeys } from "@/lib/queryKeys";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/** One TMDB backdrop candidate, as the shelves route answers it. */
type Candidate = {
  url: string;
  thumb_url: string;
  width: number | null;
  height: number | null;
  language: string | null;
};

type SearchItem = {
  tmdb_id: number;
  media_type: "movie" | "tv";
  title: string;
  release_year: number | null;
  poster_url: string | null;
};

/**
 * A shelf's cover: a mosaic of its posters, one title's backdrop picked from the
 * shelf or from a TMDB search, or an image uploaded here. The uploaded file is
 * stored by the server and served from a public cover URL, so the TV and the
 * phones draw it without a token.
 */
export function ShelfCoverEditor({
  shelfId,
  style,
  tmdbId,
  type,
  entries,
  uploadedUrl,
  coverUrl,
  onChange,
  onUploaded,
}: {
  shelfId: number;
  style: ShelfCoverStyle;
  tmdbId: number | null;
  type: "movie" | "show" | null;
  entries: ShelfEntryView[];
  uploadedUrl: string | null;
  coverUrl: string | null;
  onChange: (next: {
    coverStyle?: ShelfCoverStyle;
    coverTmdbId?: number | null;
    coverType?: "movie" | "show" | null;
    coverUrl?: string | null;
  }) => void;
  onUploaded: (shelf: ShelfDetail) => Promise<void> | void;
}) {
  const { t } = useTranslation("common");
  const fetcher = useFetcher();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<SearchItem | null>(null);

  const trimmed = query.trim();
  const search = useQuery({
    queryKey: queryKeys.shelfPicker.coverSearch(trimmed),
    queryFn: () =>
      fetcher<{ items: SearchItem[] }>(MEDIAS_ENDPOINTS.TMDB_SEARCH(trimmed)),
    enabled: style === "backdrop" && trimmed.length >= 2,
  });

  const candidates = useQuery({
    queryKey: queryKeys.shelfPicker.coverCandidates(type, tmdbId),
    queryFn: () =>
      fetcher<{ backdrops: Candidate[] }>(
        SHELVES_ENDPOINTS.COVER_CANDIDATES(tmdbId as number, type ?? "movie"),
      ),
    enabled: style === "backdrop" && tmdbId != null,
  });

  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.set("cover", file);
      return fetcher<{ shelf: ShelfDetail }>(SHELVES_ENDPOINTS.COVER(shelfId), {
        method: "POST",
        body: form,
      });
    },
    onSuccess: async (body) => {
      await onUploaded(body.shelf);
      toast.success(t("shelves.coverUploaded"));
    },
    onError: () => toast.error(t("shelves.coverUploadError")),
  });

  // Season entries share a title, so the season is part of the option's identity
  const optionValue = (entry: ShelfEntryView) =>
    `${entry.type}-${entry.tmdb_id}-${entry.season ?? ""}`;
  const onShelf = entries.find(
    (entry) => entry.tmdb_id === tmdbId && entry.type === type,
  );
  const currentTitle = picked?.title ?? onShelf?.title ?? null;
  const selectedValue = onShelf
    ? optionValue(onShelf)
    : tmdbId != null
      ? `${type}-${tmdbId}-`
      : "none";

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-neutral-400">
        {t("shelves.cover")}
      </p>
      <Select
        value={style}
        onValueChange={(value) =>
          onChange({
            coverStyle: value as ShelfCoverStyle,
            coverTmdbId: value === "backdrop" ? tmdbId : null,
            coverType: value === "backdrop" ? type : null,
          })
        }
      >
        <SelectTrigger className="h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="mosaic">{t("shelves.coverMosaic")}</SelectItem>
          <SelectItem value="backdrop">{t("shelves.coverBackdrop")}</SelectItem>
          <SelectItem value="upload">{t("shelves.coverUpload")}</SelectItem>
        </SelectContent>
      </Select>

      {style === "backdrop" && (
        <div className="space-y-2">
          <Select
            value={selectedValue}
            onValueChange={(value) => {
              if (value === "none") {
                onChange({
                  coverTmdbId: null,
                  coverType: null,
                  coverUrl: null,
                });
                setPicked(null);
                return;
              }
              const [kind, id] = value.split("-");
              onChange({
                coverTmdbId: Number(id),
                coverType: kind === "show" ? "show" : "movie",
                coverUrl: null,
              });
              setPicked(null);
            }}
          >
            <SelectTrigger className="h-9">
              <SelectValue placeholder={t("shelves.coverPick")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("shelves.coverNone")}</SelectItem>
              {tmdbId != null && !onShelf && (
                <SelectItem value={selectedValue}>
                  {currentTitle ?? t("shelves.coverCurrent")}
                </SelectItem>
              )}
              {entries.map((entry) => (
                <SelectItem key={entry.id} value={optionValue(entry)}>
                  {entry.title}
                  {entry.season != null ? ` · S${entry.season}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500"
            />
            <Input
              value={query}
              placeholder={t("shelves.coverSearchTmdb")}
              className="h-9 pl-8 text-xs"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {trimmed.length >= 2 && (search.data?.items.length ?? 0) > 0 && (
            <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-neutral-800 p-1">
              {(search.data?.items ?? []).slice(0, 6).map((item) => (
                <li key={`${item.media_type}-${item.tmdb_id}`}>
                  <button
                    type="button"
                    onClick={() => {
                      setPicked(item);
                      onChange({
                        coverTmdbId: item.tmdb_id,
                        coverType: item.media_type === "tv" ? "show" : "movie",
                        coverUrl: null,
                      });
                    }}
                    className="focus-ring flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs text-neutral-200 hover:bg-neutral-800"
                  >
                    {item.poster_url ? (
                      <img
                        src={item.poster_url}
                        alt=""
                        className="h-10 w-7 rounded object-cover"
                      />
                    ) : null}
                    <span className="truncate">
                      {item.title}
                      {item.release_year ? ` · ${item.release_year}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {tmdbId != null && (
            <div>
              <p className="mb-1 text-xs text-neutral-500">
                {currentTitle ?? t("shelves.coverCurrent")}
              </p>
              <div className="grid grid-cols-3 gap-1.5">
                {(candidates.data?.backdrops ?? []).map((candidate) => (
                  <button
                    key={candidate.url}
                    type="button"
                    aria-label={t("shelves.coverPickImage")}
                    onClick={() =>
                      onChange({
                        coverStyle: "backdrop",
                        coverUrl: candidate.url,
                      })
                    }
                    className={cn(
                      "focus-ring overflow-hidden rounded border",
                      candidate.url === coverUrl
                        ? "border-primary-400"
                        : "border-neutral-700",
                    )}
                  >
                    <img
                      src={candidate.thumb_url}
                      alt=""
                      loading="lazy"
                      className="aspect-video w-full object-cover"
                    />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {style === "upload" && (
        <div className="space-y-2">
          {uploadedUrl ? (
            <img
              src={uploadedUrl}
              alt=""
              className="aspect-video w-full rounded-lg object-cover"
            />
          ) : null}
          <label
            className={cn(
              "focus-ring flex h-9 cursor-pointer items-center justify-center gap-2 rounded-lg border border-neutral-700 bg-neutral-800/60 text-xs font-medium text-neutral-200",
              upload.isPending && "opacity-60",
            )}
          >
            <ImagePlus size={14} />
            {upload.isPending
              ? t("shelves.coverUploading")
              : t("shelves.coverUploadPick")}
            <input
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              className="sr-only"
              disabled={upload.isPending}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) upload.mutate(file);
                event.target.value = "";
              }}
            />
          </label>
          <p className="text-xs text-neutral-500">
            {t("shelves.coverUploadHint")}
          </p>
        </div>
      )}
    </div>
  );
}
