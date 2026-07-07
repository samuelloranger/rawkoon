import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMissingCollections } from "@/features/medias/hooks/useMissingCollections";
import {
  type CollectionMovieItem,
  type MediaCollection,
} from "@rawkoon/shared/types";
import { Check, Film, Clapperboard } from "lucide-react";
import { PageLayout } from "@/components/PageLayout";
import { PageHeader } from "@/components/PageHeader";
import { ExploreCardDetailDialog } from "@/pages/medias/_component/ExploreCardDetailDialog";
import { formatDate, localDateYmd } from "@rawkoon/shared/utils/date";

function CollectionCard({
  collection,
  onRefetch,
}: {
  collection: MediaCollection;
  onRefetch: () => void;
}) {
  const { t, i18n } = useTranslation("common");
  const [selectedItem, setSelectedItem] = useState<CollectionMovieItem | null>(
    null,
  );
  const todayYmd = localDateYmd();

  return (
    <>
      <div className="flex gap-4 rounded-2xl border border-neutral-700/60 bg-neutral-800/50 p-4">
        {/* Collection poster */}
        {collection.poster_url ? (
          <img
            src={collection.poster_url}
            alt={collection.name}
            className="w-20 shrink-0 rounded-xl object-cover shadow-sm ring-1 ring-primary-500/30 self-start"
          />
        ) : (
          <div className="flex w-20 shrink-0 items-center justify-center rounded-xl bg-neutral-700 aspect-[2/3]">
            <Clapperboard className="w-7 h-7 text-neutral-500" />
          </div>
        )}

        {/* Right side */}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {/* Name + progress */}
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-neutral-50 leading-tight">
              {collection.name}
            </h3>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                collection.missing_count === 0
                  ? "bg-emerald-500/15 text-emerald-400"
                  : "bg-amber-500/15 text-amber-400"
              }`}
            >
              {t("medias.collections.ownedOf", {
                owned: collection.owned_count,
                total: collection.total_count,
              })}
            </span>
          </div>

          {/* Movie mini-posters row */}
          <div className="flex flex-wrap gap-2">
            {collection.movies.map((movie) => (
              <button
                key={movie.tmdb_id}
                type="button"
                onClick={() => setSelectedItem(movie)}
                className="group relative w-12 shrink-0 overflow-hidden rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                style={{ aspectRatio: "2/3" }}
                title={movie.title}
              >
                {movie.poster_url ? (
                  <img
                    src={movie.poster_url}
                    alt={movie.title}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-neutral-700">
                    <Film className="w-3 h-3 text-neutral-500" />
                  </div>
                )}
                {/* Status overlay */}
                {movie.already_exists ? (
                  <div className="absolute inset-0 flex items-end justify-end p-0.5">
                    <div className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 ring-1 ring-black/20">
                      <Check
                        size={8}
                        strokeWidth={3}
                        className="text-neutral-950"
                      />
                    </div>
                  </div>
                ) : movie.release_date && movie.release_date > todayYmd ? (
                  <div className="absolute inset-0 bg-black/60 flex items-end justify-center pb-1 px-0.5">
                    <span className="text-[7px] font-semibold text-neutral-50 leading-tight text-center">
                      {formatDate(movie.release_date, i18n.language)}
                    </span>
                  </div>
                ) : (
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary-500 ring-1 ring-black/20 text-neutral-950 text-xs font-bold">
                      +
                    </div>
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {selectedItem && (
        <ExploreCardDetailDialog
          item={selectedItem}
          isOpen={Boolean(selectedItem)}
          onClose={() => setSelectedItem(null)}
          onAdded={() => {
            setSelectedItem(null);
            onRefetch();
          }}
        />
      )}
    </>
  );
}

export function CollectionsPage() {
  const { t, i18n } = useTranslation("common");
  const { data, isLoading, refetch } = useMissingCollections({
    language: i18n.language,
  });
  const collections = data?.collections ?? [];

  return (
    <PageLayout>
      <PageHeader
        icon={Clapperboard}
        title={t("medias.collections.pageTitle", "Collections")}
        subtitle={t(
          "medias.collections.pageSubtitle",
          "Franchises with missing entries in your library",
        )}
      />

      {isLoading && (
        <div className="flex flex-col gap-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex gap-4 rounded-2xl border border-neutral-700/60 bg-neutral-800/50 p-4 animate-pulse"
            >
              <div
                className="w-20 shrink-0 rounded-xl bg-neutral-700"
                style={{ aspectRatio: "2/3" }}
              />
              <div className="flex flex-1 flex-col gap-3 py-1">
                <div className="h-4 w-48 rounded bg-neutral-700" />
                <div className="flex gap-2">
                  {[1, 2, 3, 4].map((j) => (
                    <div
                      key={j}
                      className="w-12 rounded-lg bg-neutral-700"
                      style={{ aspectRatio: "2/3" }}
                    />
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!isLoading && collections.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
          <Film size={40} className="text-neutral-600" />
          <p className="text-sm font-medium text-neutral-400">
            {t("medias.collections.empty", "Your collection is complete!")}
          </p>
          <p className="text-xs text-neutral-500">
            {t(
              "medias.collections.emptyHint",
              "All franchises in your library are fully collected.",
            )}
          </p>
        </div>
      )}

      {!isLoading && collections.length > 0 && (
        <div className="flex flex-col gap-3">
          {collections.map((collection) => (
            <CollectionCard
              key={collection.id}
              collection={collection}
              onRefetch={refetch}
            />
          ))}
        </div>
      )}
    </PageLayout>
  );
}
