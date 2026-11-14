import { Fragment, useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  GripVertical,
  Plus,
  Rows3,
  Trash2,
  X,
} from "lucide-react";
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
import { cn } from "@/lib/utils";
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
import { GroupHeader } from "./GroupHeader";
import { useLiveReorder } from "./useLiveReorder";
import { RemovedEntries } from "./RemovedEntries";
import { AddTitlesDialog } from "./AddTitlesDialog";
import { ShelfCoverEditor } from "./ShelfCoverEditor";
import { MonthDayField } from "./MonthDayField";
import { CHRISTMAS_WINDOW } from "./monthDay";
import { moveEntry, setGroupFrom, startsGroup } from "./shelfOrder";
import { readShelfEntries, useShelfMutation } from "./useShelfMutation";
import { ShelfCover } from "./ShelfCover";
import { ShelfRulesSection } from "./ShelfRulesSection";

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
  const [seeded, setSeeded] = useState<{ id: number; draft: Draft } | null>(
    null,
  );
  const draft = seeded?.id === shelfId ? seeded.draft : null;
  const patchDraft = (patch: Partial<Draft>) =>
    setSeeded((s) => s && { ...s, draft: { ...s.draft, ...patch } });
  const [addOpen, setAddOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const shelf = useQuery({
    queryKey: queryKeys.shelves.detail(shelfId),
    // Admins also get the titles they removed, so they can put one back
    queryFn: () =>
      fetcher<{ shelf: ShelfDetail }>(
        isAdmin
          ? `${SHELVES_ENDPOINTS.DETAIL(shelfId)}?excluded=1`
          : SHELVES_ENDPOINTS.DETAIL(shelfId),
      ),
    enabled: user !== undefined,
  });

  const detail = shelf.data?.shelf;

  // Seed once per shelf (and again after a save): refetches from other edits must not wipe unsaved fields
  useEffect(() => {
    if (detail && seeded?.id !== shelfId) {
      setSeeded({ id: shelfId, draft: draftOf(detail) });
    }
  }, [detail, seeded?.id, shelfId]);

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
      const fresh = queryClient.getQueryData<{ shelf: ShelfDetail }>(
        queryKeys.shelves.detail(shelfId),
      );
      if (fresh) setSeeded({ id: shelfId, draft: draftOf(fresh.shelf) });
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

  const entriesBody = (entries: ShelfEntryView[]) => ({
    entries: entries.map((entry, position) => ({
      id: entry.id,
      position,
      group_label: entry.group_label,
    })),
  });

  const saveEntries = (errorMessage: string) =>
    // Both edits send the whole list, so one PATCH carries a reorder or a group rename
    ({
      shelfId,
      errorMessage,
      mutationFn: (entries: ShelfEntryView[]) =>
        fetcher(SHELVES_ENDPOINTS.ENTRIES(shelfId), {
          method: "PATCH",
          body: entriesBody(entries),
        }),
      apply: (shelf: ShelfDetail, entries: ShelfEntryView[]) => ({
        ...shelf,
        entries: [...entries, ...shelf.entries.filter((e) => e.excluded)],
      }),
    });

  const moveEntries = useShelfMutation(saveEntries(t("shelves.orderError")));
  const regroup = useShelfMutation(saveEntries(t("shelves.saveError")));

  const removeEntry = useShelfMutation({
    shelfId,
    errorMessage: t("shelves.removeEntryError"),
    mutationFn: (entryId: number) =>
      fetcher(SHELVES_ENDPOINTS.ENTRY(shelfId, entryId), {
        method: "DELETE",
      }),
    // A rule entry stays as excluded, so the rules never add it back
    apply: (shelf, entryId) => {
      const entries = shelf.entries
        .filter((entry) => entry.id !== entryId || entry.source === "rule")
        .map((entry) =>
          entry.id === entryId ? { ...entry, excluded: true } : entry,
        );
      const count = entries.filter((entry) => !entry.excluded).length;
      return { ...shelf, entries, entry_count: count };
    },
  });

  const putBack = useShelfMutation({
    shelfId,
    errorMessage: t("shelves.putBackError"),
    mutationFn: (entry: ShelfEntryView) =>
      fetcher(SHELVES_ENDPOINTS.ENTRIES(shelfId), {
        method: "POST",
        body: {
          tmdb_id: entry.tmdb_id,
          type: entry.type,
          season: entry.season,
        },
      }),
    apply: (shelf, back) => ({
      ...shelf,
      entries: shelf.entries.map((entry) =>
        entry.id === back.id
          ? { ...entry, excluded: false, source: "manual" as const }
          : entry,
      ),
      entry_count: shelf.entry_count + 1,
    }),
  });

  const allEntries = detail?.entries ?? [];
  const entries = allEntries.filter((entry) => !entry.excluded);
  const removed = allEntries.filter((entry) => entry.excluded);

  // A hand-made order only shows on a manual shelf, so moving a title switches it to manual
  const ensureManual = () => {
    if (!detail || detail.order_mode === "manual") return;
    queryClient.setQueryData<{ shelf: ShelfDetail }>(
      queryKeys.shelves.detail(shelfId),
      (old) => old && { shelf: { ...old.shelf, order_mode: "manual" } },
    );
    patchDraft({ orderMode: "manual" });
    void fetcher(SHELVES_ENDPOINTS.UPDATE(shelfId), {
      method: "PATCH",
      body: { order_mode: "manual" },
    }).then(
      () => toast.info(t("shelves.switchedToManual")),
      () => toast.error(t("shelves.saveError")),
    );
  };

  /** Moves a title to another index, from the cache's latest order. */
  const moveTo = (fromId: number, toIndex: number) => {
    const latest = readShelfEntries(queryClient, shelfId);
    const from = latest.findIndex((entry) => entry.id === fromId);
    if (from < 0 || from === toIndex) return;
    ensureManual();
    moveEntries.mutate(moveEntry(latest, from, toIndex));
  };

  const reorder = useLiveReorder({
    items: entries,
    idOf: (entry) => entry.id,
    move: moveEntry,
    enabled: isAdmin,
    onCommit: (next) => {
      ensureManual();
      moveEntries.mutate(next);
    },
  });
  const shown = reorder.display;

  const setGroup = (entryId: number, label: string) => {
    const latest = readShelfEntries(queryClient, shelfId);
    const index = latest.findIndex((entry) => entry.id === entryId);
    if (index >= 0) regroup.mutate(setGroupFrom(latest, index, label));
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
                  onChange={(event) => patchDraft({ name: event.target.value })}
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
                    patchDraft({ description: event.target.value })
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
                    patchDraft({ orderMode: value as ShelfOrderMode })
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
                    patchDraft({ homeRow: checked })
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
                <div className="grid grid-cols-1 gap-3">
                  <MonthDayField
                    label={t("shelves.from")}
                    value={draft.visibleFrom}
                    onChange={(value) => patchDraft({ visibleFrom: value })}
                  />
                  <MonthDayField
                    label={t("shelves.to")}
                    value={draft.visibleTo}
                    onChange={(value) => patchDraft({ visibleTo: value })}
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    patchDraft({
                      visibleFrom: CHRISTMAS_WINDOW.from,
                      visibleTo: CHRISTMAS_WINDOW.to,
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
                onChange={patchDraft}
                onUploaded={async (shelf) => {
                  // The upload response is the freshest copy; the list refetch follows
                  queryClient.setQueryData(queryKeys.shelves.detail(shelfId), {
                    shelf,
                  });
                  // The upload saved the cover server-side; drop the draft's backdrop pick with it
                  const saved = draftOf(shelf);
                  patchDraft({
                    coverStyle: saved.coverStyle,
                    coverTmdbId: saved.coverTmdbId,
                    coverType: saved.coverType,
                    coverUrl: saved.coverUrl,
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
          {isAdmin && <ShelfRulesSection key={shelfId} shelf={detail} />}
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
              {shown.map((entry, index) => (
                <Fragment key={entry.id}>
                  {startsGroup(shown, index) && (
                    <GroupHeader
                      label={entry.group_label ?? ""}
                      editable={isAdmin}
                      onRename={(label) => setGroup(entry.id, label)}
                    />
                  )}
                  <li
                    {...reorder.rowProps(entry, index)}
                    className={cn(
                      "flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 sm:flex-nowrap",
                      reorder.dragging === entry.id &&
                        "relative z-10 opacity-50 ring-1 ring-primary-400",
                    )}
                  >
                    {isAdmin && (
                      <span
                        aria-hidden
                        className="cursor-grab text-neutral-500"
                      >
                        <GripVertical size={15} />
                      </span>
                    )}
                    <span className="w-6 shrink-0 text-right text-xs tabular-nums text-neutral-500">
                      {index + 1}
                    </span>
                    <div className="h-14 w-10 shrink-0 overflow-hidden rounded bg-neutral-800">
                      {entry.poster_url ? (
                        <img
                          draggable={false}
                          src={entry.poster_url}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1 basis-32">
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
                      {isAdmin && entry.source === "rule" && (
                        <p
                          className="mt-0.5 text-xs text-neutral-500"
                          title={entry.reason?.join(", ")}
                        >
                          <span className="mr-1.5 rounded-full bg-neutral-800 px-2 py-0.5 text-neutral-300">
                            {t("shelves.rules.badge")}
                          </span>
                          {entry.reason?.join(" · ")}
                        </p>
                      )}
                    </div>
                    {isAdmin && (
                      <div className="flex w-full shrink-0 items-center justify-end sm:w-auto">
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={t("shelves.moveEarlier", {
                            title: entry.title,
                          })}
                          disabled={index === 0}
                          onClick={() => moveTo(entry.id, index - 1)}
                        >
                          <ArrowUp size={15} />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={t("shelves.moveLater", {
                            title: entry.title,
                          })}
                          disabled={index === entries.length - 1}
                          onClick={() => moveTo(entry.id, index + 1)}
                        >
                          <ArrowDown size={15} />
                        </Button>
                        {!startsGroup(shown, index) && (
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={t("shelves.groupStart", {
                              title: entry.title,
                            })}
                            onClick={() =>
                              setGroup(entry.id, t("shelves.groupNew"))
                            }
                          >
                            <Rows3 size={15} />
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={t("shelves.removeEntry")}
                          onClick={() => removeEntry.mutate(entry.id)}
                        >
                          <X size={15} />
                        </Button>
                      </div>
                    )}
                  </li>
                </Fragment>
              ))}
            </ul>
          )}
          {isAdmin && (
            <RemovedEntries
              entries={removed}
              onPutBack={(entry) => putBack.mutate(entry)}
            />
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
