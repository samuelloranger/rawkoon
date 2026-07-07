import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Search, Clapperboard } from "lucide-react";
import { useTmdbMediaSearch } from "@/features/medias/hooks/useTmdbMediaSearch";
import { type TmdbMediaSearchItem } from "@rawkoon/shared/types";
import { ExploreCardDetailDialog } from "@/pages/medias/_component/ExploreCardDetailDialog";

interface Props {
  /** Ref forwarded from parent so focus() can be called synchronously on user tap */
  inputRef?: React.RefObject<HTMLInputElement | null>;
  /** "modal" strips the card wrapper — use when rendering inside a full-screen overlay */
  variant?: "default" | "modal";
}

export function TmdbMediaSearchPanel({
  inputRef: externalInputRef,
  variant = "default",
}: Props = {}) {
  const { t, i18n } = useTranslation("common");
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selectedItem, setSelectedItem] = useState<TmdbMediaSearchItem | null>(
    null,
  );
  const internalInputRef = useRef<HTMLInputElement>(null);
  const inputRef = externalInputRef ?? internalInputRef;
  const trimmedInput = input.trim();

  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebounced(trimmedInput);
    }, 350);
    return () => clearTimeout(timeout);
  }, [trimmedInput]);

  const searchEnabled = debounced.length >= 2;
  const searchQuery = useTmdbMediaSearch(debounced, {
    enabled: searchEnabled,
    language: i18n.language,
  });

  const results = useMemo(
    () => searchQuery.data?.items ?? [],
    [searchQuery.data?.items],
  );

  const searchContent = (
    <div className="space-y-3">
      <div className="relative">
        <Search
          size={13}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none"
        />
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("medias.tmdb.placeholder")}
          className="w-full rounded-xl border border-neutral-700 bg-neutral-950 pl-8 pr-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-primary-500/40 focus:border-primary-500 transition"
        />
      </div>

      {searchEnabled ? (
        searchQuery.isLoading ? (
          <div className="text-sm text-neutral-400">
            {t("medias.tmdb.searching")}
          </div>
        ) : results.length === 0 ? (
          <div className="text-sm text-neutral-400">
            {t("medias.tmdb.noResults")}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {results.map((item) => {
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    const libId = item.library_id;
                    if (item.already_exists && libId != null && libId > 0) {
                      void navigate({
                        to: "/library/$libraryId",
                        params: { libraryId: String(libId) },
                      });
                      return;
                    }
                    setSelectedItem(item);
                  }}
                  className="text-left rounded-xl border p-2.5 flex gap-2.5 transition-colors border-neutral-700 bg-neutral-900 hover:bg-neutral-800 cursor-pointer"
                >
                  <div className="w-12 h-16 shrink-0 rounded-md overflow-hidden bg-neutral-700">
                    {item.poster_url ? (
                      <img
                        src={item.poster_url}
                        alt={item.title}
                        loading="lazy"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Clapperboard className="w-5 h-5 text-neutral-500" />
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-neutral-50 line-clamp-2">
                      {item.title}
                    </p>
                    <p className="text-xs text-neutral-400 mt-0.5">
                      {item.release_year ?? t("medias.unknownYear")}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {item.library_id != null && item.library_id > 0 ? (
                        <span className="rounded-full border border-primary-800 px-2 py-0.5 text-[10px] font-medium bg-primary-900/30 text-primary-300">
                          {t("medias.tmdb.badgeLibrary")}
                        </span>
                      ) : null}
                      {item.already_exists ? (
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-medium bg-emerald-500/20 text-emerald-300">
                          {t("medias.tmdb.inLibrary")}
                        </span>
                      ) : !item.can_add ? (
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-medium bg-amber-500/20 text-amber-300">
                          {t("medias.tmdb.notConfigured")}
                        </span>
                      ) : (
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-medium bg-primary-500/20 text-primary-300">
                          {t("medias.tmdb.add")}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )
      ) : (
        <div className="text-xs text-neutral-400">{t("medias.tmdb.hint")}</div>
      )}
    </div>
  );

  const dialog = selectedItem && (
    <ExploreCardDetailDialog
      item={selectedItem}
      isOpen
      onClose={() => setSelectedItem(null)}
      onAdded={() => {
        setSelectedItem(null);
        searchQuery.refetch();
      }}
    />
  );

  if (variant === "modal") {
    return (
      <>
        {searchContent}
        {dialog}
      </>
    );
  }

  return (
    <>
      <section className="rounded-2xl border border-neutral-700/60 bg-neutral-900 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-neutral-800">
          <p className="text-sm font-semibold text-neutral-50">
            {t("medias.tmdb.title")}
          </p>
          <p className="text-xs text-neutral-400 mt-0.5">
            {t("medias.tmdb.subtitle")}
          </p>
        </div>
        <div className="p-4">{searchContent}</div>
      </section>
      {dialog}
    </>
  );
}
