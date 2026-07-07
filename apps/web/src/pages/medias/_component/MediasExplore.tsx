import { useRef, useState } from "react";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { TmdbMediaSearchPanel } from "@/pages/medias/_component/TmdbMediaSearchPanel";
import { DiscoverPanel } from "@/pages/medias/_component/DiscoverPanel";
import { TmdbSearchModal } from "@/pages/medias/_component/TmdbSearchModal";

export function MediasExplore() {
  const { t } = useTranslation("common");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  function openSearch() {
    setSearchOpen(true);
    // Must be synchronous within the user gesture — iOS/Android only open
    // the keyboard when focus() is called in the same call stack as the tap.
    searchInputRef.current?.focus();
  }

  return (
    <div className="pb-10">
      <div className="space-y-6">
        {/* Mobile: dormant search trigger — same visual as TmdbMediaSearchPanel card */}
        <button
          type="button"
          onClick={openSearch}
          className="md:hidden w-full text-left"
        >
          <section className="rounded-2xl border border-neutral-700/60 bg-neutral-900 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-neutral-800">
              <p className="text-sm font-semibold text-neutral-50">
                {t("medias.tmdb.title")}
              </p>
              <p className="text-xs text-neutral-400 mt-0.5">
                {t("medias.tmdb.subtitle")}
              </p>
            </div>
            <div className="p-4">
              <div className="relative pointer-events-none">
                <Search
                  size={13}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
                />
                <div className="w-full rounded-xl border border-neutral-700 bg-neutral-950 pl-8 pr-3 py-2 text-sm text-neutral-500">
                  {t("medias.tmdb.placeholder")}
                </div>
              </div>
            </div>
          </section>
        </button>

        {/* Desktop: real search panel */}
        <div className="hidden md:block">
          <TmdbMediaSearchPanel />
        </div>

        {/* Discover: always visible */}
        <DiscoverPanel />
      </div>

      {/* Mobile search modal — always mounted so the input exists in the DOM
          and focus() can be called synchronously before React re-renders. */}
      <TmdbSearchModal
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
        inputRef={searchInputRef}
      />
    </div>
  );
}
