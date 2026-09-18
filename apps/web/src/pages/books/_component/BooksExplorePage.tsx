import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Trophy } from "lucide-react";
import type { BookDiscoveryBook } from "@rawkoon/shared/types";
import { PageLayout } from "@/components/PageLayout";
import { PageHeader } from "@/components/PageHeader";
import {
  useBookDiscovery,
  useBookDiscoverySources,
} from "@/pages/books/_hooks/useBookDiscovery";
import { DiscoveryBookCard } from "./DiscoveryBookCard";
import { DiscoveryBookSheet } from "./DiscoveryBookSheet";

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`focus-ring rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? "bg-primary-500/15 text-primary-200"
          : "bg-neutral-800 text-neutral-400 hover:text-neutral-200"
      }`}
    >
      {children}
    </button>
  );
}

export function BooksExplorePage() {
  const { t } = useTranslation("common");
  const { data: sourcesData, isLoading: sourcesLoading } =
    useBookDiscoverySources();
  const sources = useMemo(() => sourcesData?.sources ?? [], [sourcesData]);

  const [source, setSource] = useState<string | null>(null);
  const [list, setList] = useState<string | null>(null);
  const [selected, setSelected] = useState<BookDiscoveryBook | null>(null);

  // Default to the first configured source + its first list once they load.
  useEffect(() => {
    if (!source && sources.length > 0) {
      setSource(sources[0].id);
      setList(sources[0].lists[0]?.id ?? null);
    }
  }, [sources, source]);

  const activeSource = sources.find((s) => s.id === source) ?? null;

  const { data, isLoading, isError, refetch, isFetching } = useBookDiscovery(
    source ?? "",
    list ?? "",
  );

  const changeSource = (id: string) => {
    const next = sources.find((s) => s.id === id);
    setSource(id);
    setList(next?.lists[0]?.id ?? null);
  };

  const items = data?.items ?? [];

  return (
    <PageLayout>
      <PageHeader
        icon={Trophy}
        iconColor="text-primary-400"
        title={t("books.explore.pageTitle")}
        subtitle={t("books.explore.pageSubtitle")}
        onRefresh={() => void refetch()}
        isRefreshing={isFetching}
      />

      {sources.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {sources.map((s) => (
            <Pill
              key={s.id}
              active={s.id === source}
              onClick={() => changeSource(s.id)}
            >
              {s.label}
            </Pill>
          ))}
        </div>
      )}

      {activeSource && activeSource.lists.length > 1 && (
        <div className="mb-5 flex flex-wrap gap-1.5">
          {activeSource.lists.map((l) => (
            <Pill
              key={l.id}
              active={l.id === list}
              onClick={() => setList(l.id)}
            >
              {l.label}
            </Pill>
          ))}
        </div>
      )}

      {sourcesLoading || isLoading ? (
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="aspect-[2/3] animate-pulse rounded-lg bg-neutral-900"
            />
          ))}
        </div>
      ) : isError ? (
        <div className="py-16 text-center">
          <p className="text-sm text-neutral-400">{t("books.explore.error")}</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="focus-ring mt-3 rounded-lg bg-neutral-800 px-4 py-2 text-sm text-neutral-100 hover:bg-neutral-700"
          >
            {t("books.explore.retry")}
          </button>
        </div>
      ) : items.length === 0 ? (
        <p className="py-16 text-center text-sm text-neutral-500">
          {t("books.explore.empty")}
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-6">
          {items.map((book) => (
            <DiscoveryBookCard
              key={`${book.rank}-${book.isbn13 ?? book.title}`}
              book={book}
              onOpen={setSelected}
            />
          ))}
        </div>
      )}

      {selected && (
        <DiscoveryBookSheet book={selected} onClose={() => setSelected(null)} />
      )}
    </PageLayout>
  );
}
