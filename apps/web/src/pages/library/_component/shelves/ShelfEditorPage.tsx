import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { ShelfDetail, ShelfEntryView } from "@rawkoon/shared/types";
import { useFetcher } from "@/lib/api/context";
import { useAuth } from "@/lib/auth/useAuth";
import { SHELVES_ENDPOINTS } from "@/lib/endpoints";
import { queryKeys } from "@/lib/queryKeys";
import { PageLayout } from "@/components/PageLayout";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState } from "@/components/LoadingState";
import { Button } from "@/components/ui/button";
import { useLiveReorder } from "./useLiveReorder";
import { RemovedEntries } from "./RemovedEntries";
import { AddTitlesDialog } from "./AddTitlesDialog";
import { moveEntry, setGroupFrom } from "./shelfOrder";
import { readShelfEntries, useShelfMutation } from "./useShelfMutation";
import { ShelfCover } from "./ShelfCover";
import { ShelfRulesSection } from "./ShelfRulesSection";
import { DeleteShelfDialog } from "./DeleteShelfDialog";
import { ShelfEntriesList } from "./ShelfEntriesList";
import { ShelfSettingsForm } from "./ShelfSettingsForm";
import { draftOf, type Draft } from "./shelfDraft";

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
            <ShelfSettingsForm
              shelfId={shelfId}
              detail={detail}
              draft={draft}
              patchDraft={patchDraft}
              entries={entries}
              dirty={dirty}
              saving={save.isPending}
              onSave={() => save.mutate(draft)}
              invalidate={invalidate}
            />
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
            <ShelfEntriesList
              shown={shown}
              count={entries.length}
              reorder={reorder}
              isAdmin={isAdmin}
              moveTo={moveTo}
              setGroup={setGroup}
              onRemove={(entryId) => removeEntry.mutate(entryId)}
            />
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

      <DeleteShelfDialog
        isOpen={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        name={detail.name}
        pending={removeShelf.isPending}
        onConfirm={() => removeShelf.mutate()}
      />
    </PageLayout>
  );
}
