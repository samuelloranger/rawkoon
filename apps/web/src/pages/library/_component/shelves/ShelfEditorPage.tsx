import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowLeft, GripVertical, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import type {
  ShelfDetail,
  ShelfEntryView,
  ShelfOrderMode,
} from "@rawkoon/shared/types";
import { useFetcher } from "@/lib/api/context";
import { useAuth } from "@/lib/auth/useAuth";
import { SHELVES_ENDPOINTS } from "@/lib/endpoints";
import { queryKeys } from "@/lib/queryKeys";
import { PageLayout } from "@/components/PageLayout";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState } from "@/components/LoadingState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog } from "@/components/dialog";
import { AddTitlesDialog } from "./AddTitlesDialog";
import { ShelfCoverEditor } from "./ShelfCoverEditor";
import { MonthDayField } from "./MonthDayField";
import { ShelfCover } from "./ShelfCover";

type Draft = {
  name: string;
  description: string;
  orderMode: ShelfOrderMode;
  homeRow: boolean;
  visibleFrom: string | null;
  visibleTo: string | null;
  coverStyle: "mosaic" | "backdrop" | "upload";
  coverTmdbId: number | null;
  coverType: "movie" | "show" | null;
  coverUrl: string | null;
};

const draftOf = (shelf: ShelfDetail): Draft => ({
  name: shelf.name,
  description: shelf.description ?? "",
  orderMode: shelf.order_mode,
  homeRow: shelf.home_row,
  visibleFrom: shelf.visible_from,
  visibleTo: shelf.visible_to,
  coverStyle: shelf.cover.style,
  coverTmdbId: shelf.cover_tmdb_id,
  coverType: shelf.cover_type,
  coverUrl: shelf.cover.style === "backdrop" ? shelf.cover.backdrop_url : null,
});

/** Library → Shelves → one shelf: its settings, and its titles in display order. */
export function ShelfEditorPage({ shelfId }: { shelfId: number }) {
  const { t } = useTranslation("common");
  const { user } = useAuth();
  const isAdmin = user?.is_admin ?? false;
  const fetcher = useFetcher();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [dragId, setDragId] = useState<number | null>(null);

  const shelf = useQuery({
    queryKey: queryKeys.shelves.detail(shelfId),
    queryFn: () =>
      fetcher<{ shelf: ShelfDetail }>(SHELVES_ENDPOINTS.DETAIL(shelfId)),
  });

  const detail = shelf.data?.shelf;

  // The form follows the server's copy until the user edits it
  useEffect(() => {
    if (detail) setDraft(draftOf(detail));
  }, [detail]);

  const invalidate = async () => {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.shelves.detail(shelfId),
    });
    await queryClient.invalidateQueries({ queryKey: queryKeys.shelves.all });
  };

  const save = useMutation({
    mutationFn: (next: Draft) =>
      fetcher(SHELVES_ENDPOINTS.UPDATE(shelfId), {
        method: "PATCH",
        body: {
          name: next.name.trim(),
          description: next.description.trim() || null,
          order_mode: next.orderMode,
          home_row: next.homeRow,
          visible_from: next.visibleFrom,
          visible_to: next.visibleTo,
          cover_style: next.coverStyle,
          cover_tmdb_id: next.coverTmdbId,
          cover_type: next.coverType,
          cover_url: next.coverStyle === "backdrop" ? next.coverUrl : null,
        },
      }),
    onSuccess: async () => {
      await invalidate();
      toast.success(t("shelves.saved"));
    },
    onError: () => toast.error(t("shelves.saveError")),
  });

  const removeShelf = useMutation({
    mutationFn: () =>
      fetcher(SHELVES_ENDPOINTS.DELETE(shelfId), { method: "DELETE" }),
    onSuccess: async () => {
      await invalidate();
      void navigate({ to: "/library/shelves" });
    },
    onError: () => toast.error(t("shelves.deleteError")),
  });

  const moveEntries = useMutation({
    mutationFn: (entries: ShelfEntryView[]) =>
      fetcher(SHELVES_ENDPOINTS.ENTRIES(shelfId), {
        method: "PATCH",
        body: {
          entries: entries.map((entry, position) => ({
            id: entry.id,
            position,
            group_label: entry.group_label,
          })),
        },
      }),
    onSuccess: invalidate,
    onError: () => toast.error(t("shelves.orderError")),
  });

  const removeEntry = useMutation({
    mutationFn: (entryId: number) =>
      fetcher(SHELVES_ENDPOINTS.ENTRY(shelfId, entryId), {
        method: "DELETE",
      }),
    onSuccess: invalidate,
    onError: () => toast.error(t("shelves.removeEntryError")),
  });

  const setGroupLabel = useMutation({
    mutationFn: ({ entry, label }: { entry: ShelfEntryView; label: string }) =>
      fetcher(SHELVES_ENDPOINTS.ENTRIES(shelfId), {
        method: "PATCH",
        body: {
          entries: [
            {
              id: entry.id,
              position: entry.position,
              group_label: label.trim() || null,
            },
          ],
        },
      }),
    onSuccess: invalidate,
    onError: () => toast.error(t("shelves.saveError")),
  });

  const entries = detail?.entries ?? [];

  /** Moves the dragged title before the one it was dropped on. */
  const moveBefore = (dragged: number, before: number) => {
    const from = entries.findIndex((entry) => entry.id === dragged);
    const to = entries.findIndex((entry) => entry.id === before);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...entries];
    next.splice(to, 0, next.splice(from, 1)[0]);
    moveEntries.mutate(next);
  };

  if (shelf.isLoading || !detail || !draft) return <LoadingState />;

  const dirty =
    draft.name !== detail.name ||
    draft.description !== (detail.description ?? "") ||
    draft.orderMode !== detail.order_mode ||
    draft.homeRow !== detail.home_row ||
    draft.visibleFrom !== detail.visible_from ||
    draft.visibleTo !== detail.visible_to ||
    draft.coverStyle !== detail.cover.style ||
    draft.coverTmdbId !== detail.cover_tmdb_id ||
    draft.coverType !== detail.cover_type ||
    (draft.coverStyle === "backdrop" &&
      draft.coverUrl !==
        (detail.cover.style === "backdrop" ? detail.cover.backdrop_url : null));

  return (
    <PageLayout>
      <Link
        to="/library/shelves"
        className="focus-ring mb-3 inline-flex items-center gap-1.5 text-sm text-neutral-400 hover:text-neutral-200"
      >
        <ArrowLeft size={15} />
        {t("shelves.backToList")}
      </Link>
      <PageHeader
        title={detail.name}
        subtitle={t("shelves.titles", { count: detail.entry_count })}
        actions={
          isAdmin ? (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setAddOpen(true)}
              >
                <Plus size={15} />
                {t("shelves.addTitles")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={t("shelves.delete")}
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 size={15} />
              </Button>
            </div>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
        <div className="space-y-4">
          <ShelfCover shelf={detail} />
          {isAdmin ? (
            <div className="space-y-4 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="shelf-name"
                  className="text-xs font-medium text-neutral-400"
                >
                  {t("shelves.name")}
                </label>
                <Input
                  id="shelf-name"
                  value={draft.name}
                  maxLength={120}
                  onChange={(event) =>
                    setDraft({ ...draft, name: event.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="shelf-description"
                  className="text-xs font-medium text-neutral-400"
                >
                  {t("shelves.description")}
                </label>
                <Textarea
                  id="shelf-description"
                  value={draft.description}
                  rows={3}
                  maxLength={2000}
                  onChange={(event) =>
                    setDraft({ ...draft, description: event.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-neutral-400">
                  {t("shelves.orderMode")}
                </p>
                <Select
                  value={draft.orderMode}
                  onValueChange={(value) =>
                    setDraft({ ...draft, orderMode: value as ShelfOrderMode })
                  }
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">
                      {t("shelves.order.manual")}
                    </SelectItem>
                    <SelectItem value="release">
                      {t("shelves.order.release")}
                    </SelectItem>
                    <SelectItem value="rating">
                      {t("shelves.order.rating")}
                    </SelectItem>
                    <SelectItem value="added">
                      {t("shelves.order.added")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-neutral-200">
                    {t("shelves.homeRow")}
                  </p>
                  <p className="text-xs text-neutral-500">
                    {t("shelves.homeRowHint")}
                  </p>
                </div>
                <Switch
                  checked={draft.homeRow}
                  onCheckedChange={(checked) =>
                    setDraft({ ...draft, homeRow: checked })
                  }
                />
              </div>
              <div className="space-y-2">
                <p className="text-sm text-neutral-200">
                  {t("shelves.window")}
                </p>
                <p className="text-xs text-neutral-500">
                  {t("shelves.windowHint")}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <MonthDayField
                    label={t("shelves.from")}
                    value={draft.visibleFrom}
                    onChange={(value) =>
                      setDraft({ ...draft, visibleFrom: value })
                    }
                  />
                  <MonthDayField
                    label={t("shelves.to")}
                    value={draft.visibleTo}
                    onChange={(value) =>
                      setDraft({ ...draft, visibleTo: value })
                    }
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      visibleFrom: "11-01",
                      visibleTo: "01-15",
                    })
                  }
                >
                  {t("shelves.christmasPreset")}
                </Button>
              </div>
              <ShelfCoverEditor
                shelfId={shelfId}
                style={draft.coverStyle}
                tmdbId={draft.coverTmdbId}
                type={draft.coverType}
                entries={entries}
                uploadedUrl={
                  detail.cover.style === "upload" ? detail.cover.url : null
                }
                coverUrl={draft.coverUrl}
                onChange={(next) => setDraft({ ...draft, ...next })}
                onUploaded={async (shelf) => {
                  // The upload response is the freshest copy; the list refetch follows
                  queryClient.setQueryData(queryKeys.shelves.detail(shelfId), {
                    shelf,
                  });
                  await invalidate();
                }}
              />
              <Button
                size="sm"
                disabled={
                  !dirty || save.isPending || draft.name.trim().length === 0
                }
                onClick={() => save.mutate(draft)}
                className="w-full"
              >
                {save.isPending ? t("shelves.saving") : t("shelves.save")}
              </Button>
            </div>
          ) : null}
        </div>

        <div className="min-w-0">
          <h2 className="mb-2 text-sm font-medium text-neutral-300">
            {t("shelves.entries")}
          </h2>
          {entries.length === 0 ? (
            <p className="rounded-xl border border-dashed border-neutral-800 p-6 text-center text-sm text-neutral-500">
              {isAdmin
                ? t("shelves.entriesEmptyAdmin")
                : t("shelves.entriesEmpty")}
            </p>
          ) : (
            <ul className="divide-y divide-neutral-800 rounded-xl border border-neutral-800">
              {entries.map((entry, index) => (
                <li
                  key={entry.id}
                  draggable={isAdmin}
                  onDragStart={() => setDragId(entry.id)}
                  onDragOver={(event) => {
                    if (isAdmin) event.preventDefault();
                  }}
                  onDrop={() => {
                    if (dragId != null && dragId !== entry.id) {
                      moveBefore(dragId, entry.id);
                    }
                    setDragId(null);
                  }}
                  className="flex items-center gap-3 px-3 py-2"
                >
                  {isAdmin && (
                    <span className="cursor-grab text-neutral-600">
                      <GripVertical size={15} />
                    </span>
                  )}
                  <span className="w-6 shrink-0 text-right text-xs tabular-nums text-neutral-500">
                    {index + 1}
                  </span>
                  <div className="h-14 w-10 shrink-0 overflow-hidden rounded bg-neutral-800">
                    {entry.poster_url ? (
                      <img
                        src={entry.poster_url}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-neutral-100">
                      {entry.title}
                      {entry.season != null ? ` · S${entry.season}` : ""}
                    </p>
                    <p className="text-xs text-neutral-500">
                      {[entry.year, t(`shelves.type.${entry.type}`)]
                        .filter(Boolean)
                        .join(" · ")}
                      {entry.in_library
                        ? ` · ${t("shelves.inLibrary")}`
                        : ` · ${t("shelves.notInLibrary")}`}
                    </p>
                  </div>
                  {isAdmin && (
                    <>
                      <Input
                        defaultValue={entry.group_label ?? ""}
                        placeholder={t("shelves.groupLabel")}
                        className="h-8 w-32 shrink-0 text-xs"
                        onBlur={(event) => {
                          const label = event.target.value;
                          if ((entry.group_label ?? "") !== label) {
                            setGroupLabel.mutate({ entry, label });
                          }
                        }}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={t("shelves.removeEntry")}
                        onClick={() => removeEntry.mutate(entry.id)}
                      >
                        <X size={15} />
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <AddTitlesDialog
        shelfId={shelfId}
        onShelf={entries}
        isOpen={addOpen}
        onClose={() => setAddOpen(false)}
      />

      <Dialog
        isOpen={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={t("shelves.deleteTitle")}
      >
        <div className="space-y-4 px-1 pb-2 text-left">
          <p className="text-sm text-neutral-300">
            {t("shelves.deleteBody", { name: detail.name })}
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDeleteOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={removeShelf.isPending}
              onClick={() => removeShelf.mutate()}
            >
              {t("shelves.delete")}
            </Button>
          </div>
        </div>
      </Dialog>
    </PageLayout>
  );
}
