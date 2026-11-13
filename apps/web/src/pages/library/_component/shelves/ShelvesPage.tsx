import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  ArrowRight,
  GripVertical,
  Layers,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import type { ShelfSummary } from "@rawkoon/shared/types";
import { useFetcher } from "@/lib/api/context";
import { useAuth } from "@/lib/auth/useAuth";
import { SHELVES_ENDPOINTS } from "@/lib/endpoints";
import { queryKeys } from "@/lib/queryKeys";
import { PageLayout } from "@/components/PageLayout";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { LibrarySwitch } from "@/pages/medias/_component/LibrarySwitch";
import { NewShelfDialog } from "./NewShelfDialog";
import { moveBefore } from "./shelfOrder";
import { ShelfCover } from "./ShelfCover";

/** Library → Shelves: every shelf as its cover, in the order the TV shows them. */
export function ShelvesPage() {
  const { t } = useTranslation("common");
  const { user } = useAuth();
  const isAdmin = user?.is_admin ?? false;
  const fetcher = useFetcher();
  const queryClient = useQueryClient();
  const [newShelfOpen, setNewShelfOpen] = useState(false);
  const [dragId, setDragId] = useState<number | null>(null);

  const shelves = useQuery({
    queryKey: queryKeys.shelves.list(isAdmin),
    queryFn: () =>
      fetcher<{ shelves: ShelfSummary[] }>(
        isAdmin ? SHELVES_ENDPOINTS.ALL : SHELVES_ENDPOINTS.LIST,
      ),
  });

  const listKey = queryKeys.shelves.list(isAdmin);
  type ListCache = { shelves: ShelfSummary[] };

  const reorder = useMutation({
    mutationFn: (ids: number[]) =>
      fetcher<{ ok: boolean }>(SHELVES_ENDPOINTS.ORDER, {
        method: "PUT",
        body: { ids },
      }),
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: listKey });
      const previous = queryClient.getQueryData<ListCache>(listKey);
      queryClient.setQueryData<ListCache>(listKey, (old) =>
        old
          ? {
              shelves: ids.flatMap((id) =>
                old.shelves.filter((shelf) => shelf.id === id),
              ),
            }
          : old,
      );
      return { previous };
    },
    onError: (_error, _ids, context) => {
      if (context?.previous)
        queryClient.setQueryData(listKey, context.previous);
      toast.error(t("shelves.orderError"));
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.shelves.all }),
  });

  const list = shelves.data?.shelves ?? [];

  /** Moves a shelf to another index, from the cache's latest order, and saves it. */
  const moveTo = (shelfId: number, toIndex: number) => {
    const latest = queryClient.getQueryData<ListCache>(listKey)?.shelves ?? [];
    const from = latest.findIndex((shelf) => shelf.id === shelfId);
    if (from < 0 || from === toIndex) return;
    reorder.mutate(moveBefore(latest, from, toIndex).map((shelf) => shelf.id));
  };

  return (
    <PageLayout>
      <LibrarySwitch active="media" />
      <PageHeader
        title={t("shelves.pageTitle")}
        subtitle={t("shelves.pageSubtitle", { count: list.length })}
        actions={
          isAdmin ? (
            <Button size="sm" onClick={() => setNewShelfOpen(true)}>
              <Plus size={15} />
              {t("shelves.new")}
            </Button>
          ) : undefined
        }
      />

      {shelves.isLoading ? (
        <LoadingState />
      ) : list.length === 0 ? (
        <EmptyState
          icon={Layers}
          title={t("shelves.emptyTitle")}
          description={
            isAdmin ? t("shelves.emptyAdmin") : t("shelves.emptyUser")
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {list.map((shelf, index) => (
            <li
              key={shelf.id}
              draggable={isAdmin}
              onDragStart={() => setDragId(shelf.id)}
              onDragEnd={() => setDragId(null)}
              onDragOver={(event) => {
                if (isAdmin) event.preventDefault();
              }}
              onDrop={() => {
                if (dragId != null && dragId !== shelf.id) {
                  moveTo(dragId, index);
                }
                setDragId(null);
              }}
              className="relative"
            >
              <Link
                to="/library/shelves/$shelfId"
                params={{ shelfId: String(shelf.id) }}
                className="focus-ring block rounded-xl transition-transform hover:-translate-y-0.5"
              >
                <ShelfCover shelf={shelf} />
              </Link>
              {isAdmin && (
                <div className="absolute left-1 top-1 flex items-center rounded bg-neutral-900/80 text-neutral-300">
                  <span aria-hidden className="cursor-grab p-1">
                    <GripVertical size={14} />
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-1.5"
                    aria-label={t("shelves.moveEarlier", { title: shelf.name })}
                    disabled={index === 0}
                    onClick={() => moveTo(shelf.id, index - 1)}
                  >
                    <ArrowLeft size={14} />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-1.5"
                    aria-label={t("shelves.moveLater", { title: shelf.name })}
                    disabled={index === list.length - 1}
                    onClick={() => moveTo(shelf.id, index + 1)}
                  >
                    <ArrowRight size={14} />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <NewShelfDialog
        isOpen={newShelfOpen}
        onClose={() => setNewShelfOpen(false)}
      />
    </PageLayout>
  );
}
