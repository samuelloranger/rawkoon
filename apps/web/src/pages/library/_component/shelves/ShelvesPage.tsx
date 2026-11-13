import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { GripVertical, Layers, Plus } from "lucide-react";
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

  const reorder = useMutation({
    mutationFn: (ids: number[]) =>
      fetcher<{ ok: boolean }>(SHELVES_ENDPOINTS.ORDER, {
        method: "PUT",
        body: { ids },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.shelves.all,
      });
    },
    onError: () => toast.error(t("shelves.orderError")),
  });

  const list = shelves.data?.shelves ?? [];

  /** Moves the dragged shelf before the one it was dropped on, and saves the new order. */
  const moveBefore = (dragged: number, before: number) => {
    const ids = list.map((shelf) => shelf.id);
    const from = ids.indexOf(dragged);
    const to = ids.indexOf(before);
    if (from < 0 || to < 0 || from === to) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    reorder.mutate(ids);
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
          {list.map((shelf) => (
            <li
              key={shelf.id}
              draggable={isAdmin}
              onDragStart={() => setDragId(shelf.id)}
              onDragOver={(event) => {
                if (isAdmin) event.preventDefault();
              }}
              onDrop={() => {
                if (dragId != null && dragId !== shelf.id) {
                  moveBefore(dragId, shelf.id);
                }
                setDragId(null);
              }}
              className="group relative"
            >
              <Link
                to="/library/shelves/$shelfId"
                params={{ shelfId: String(shelf.id) }}
                className="focus-ring block rounded-xl transition-transform hover:-translate-y-0.5"
              >
                <ShelfCover shelf={shelf} />
              </Link>
              {isAdmin && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute -left-1 top-1/2 hidden -translate-y-1/2 cursor-grab rounded bg-neutral-900/80 p-1 text-neutral-400 group-hover:block"
                >
                  <GripVertical size={14} />
                </span>
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
