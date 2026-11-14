import { useState } from "react";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import type {
  ShelfDetail,
  ShelfLookupItem,
  ShelfPreview,
  ShelfPreviewTitle,
} from "@rawkoon/shared/types";
import { useFetcher } from "@/lib/api/context";
import { SHELVES_ENDPOINTS } from "@/lib/endpoints";
import { queryKeys } from "@/lib/queryKeys";
import { useMediaGenres } from "@/features/medias/hooks/useMediaGenres";
import { useDebounced } from "@/features/transcode/useDebounced";
import { useConfirm } from "@/components/confirm/ConfirmContext";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  draftFromRules,
  emptyRulesDraft,
  rulesEqual,
  rulesFromDraft,
  type RulesDraft,
} from "./rulesDraft";

import {
  Field,
  GenrePills,
  LookupField,
  NumberField,
  PreviewRow,
  TokenField,
} from "./RulesFields";

type IdList = "keywordsAny" | "keywordsNone" | "companiesAny";

/** Admin-only: edit a shelf's rules, preview what they select, seed from them, and toggle auto-join. */
export function ShelfRulesSection({ shelf }: { shelf: ShelfDetail }) {
  const { t, i18n } = useTranslation("common");
  const fetcher = useFetcher();
  const queryClient = useQueryClient();
  const { confirm } = useConfirm();
  const [draft, setDraft] = useState<RulesDraft>(() =>
    draftFromRules(shelf.rules),
  );
  // Saved ids get their names from the server; new picks add theirs as they're made
  const [names, setNames] = useState(
    () =>
      new Map(
        Object.entries(shelf.rule_names ?? {}).flatMap(([key, name]) => {
          const [kind, id] = key.split(":");
          const field =
            kind === "keyword"
              ? "keywords"
              : kind === "company"
                ? "companies"
                : null;
          return field ? [[`${field}:${id}`, name] as const] : [];
        }),
      ),
  );
  const patch = (next: Partial<RulesDraft>) =>
    setDraft((d) => ({ ...d, ...next }));
  const toggle = <K extends "genresAny" | "genresNone" | "types">(
    key: K,
    value: RulesDraft[K][number],
  ) =>
    setDraft((d) => {
      const list = d[key] as (typeof value)[];
      return {
        ...d,
        [key]: list.includes(value)
          ? list.filter((v) => v !== value)
          : [...list, value],
      };
    });

  const language = i18n.language.startsWith("fr") ? "fr-FR" : "en-US";
  const movieGenres = useMediaGenres("movie", language);
  const tvGenres = useMediaGenres("tv", language);
  const genres = [
    ...new Map(
      [
        ...(movieGenres.data?.genres ?? []),
        ...(tvGenres.data?.genres ?? []),
      ].map((g) => [g.id, g]),
    ).values(),
  ].sort((a, b) => a.name.localeCompare(b.name));
  // Saved ids stay visible (and removable) while the genre list is unavailable
  for (const id of [...draft.genresAny, ...draft.genresNone]) {
    if (!genres.some((g) => g.id === id)) genres.push({ id, name: `#${id}` });
  }

  const rules = rulesFromDraft(draft);
  const dirty = !rulesEqual(rules, shelf.rules);
  const debouncedRules = useDebounced(rules, 500);
  const rulesKey = JSON.stringify(debouncedRules);

  const preview = useQuery({
    queryKey: queryKeys.shelfPicker.preview(shelf.id, rulesKey),
    queryFn: () =>
      fetcher<ShelfPreview>(SHELVES_ENDPOINTS.PREVIEW(shelf.id), {
        method: "POST",
        body: { rules: debouncedRules },
      }),
    enabled: debouncedRules != null,
    placeholderData: keepPreviousData,
    retry: false,
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.shelves.detail(shelf.id),
    });
    await queryClient.invalidateQueries({ queryKey: queryKeys.shelves.all });
    await queryClient.invalidateQueries({
      queryKey: queryKeys.shelfPicker.previewAll,
    });
  };

  const patchShelf = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetcher(SHELVES_ENDPOINTS.UPDATE(shelf.id), { method: "PATCH", body }),
    onSuccess: refresh,
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : t("shelves.saveError"),
      ),
  });

  const seed = useMutation({
    mutationFn: () =>
      fetcher<{ shelf: ShelfDetail }>(
        SHELVES_ENDPOINTS.SEED_FROM_RULES(shelf.id),
        {
          method: "POST",
        },
      ),
    onSuccess: async ({ shelf: next }) => {
      const added = Math.max(0, next.entry_count - shelf.entry_count);
      queryClient.setQueryData(queryKeys.shelves.detail(shelf.id), {
        shelf: next,
      });
      await refresh();
      toast.success(t("shelves.rules.seeded", { count: added }));
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : t("shelves.rules.seedError"),
      ),
  });

  const pin = useMutation({
    mutationFn: (item: ShelfPreviewTitle) =>
      fetcher(SHELVES_ENDPOINTS.ENTRIES(shelf.id), {
        method: "POST",
        body: { tmdb_id: item.tmdb_id, type: item.type },
      }),
    onSuccess: async () => {
      await refresh();
      toast.success(t("shelves.added"));
    },
    onError: () => toast.error(t("shelves.addError")),
  });

  const addId =
    (list: IdList, kind: "keyword" | "company") => (item: ShelfLookupItem) => {
      setNames((m) =>
        new Map(m).set(
          `${kind === "keyword" ? "keywords" : "companies"}:${item.id}`,
          item.name,
        ),
      );
      setDraft((d) => ({ ...d, [list]: [...d[list], item.id] }));
    };
  const removeId = (list: IdList) => (id: number) =>
    setDraft((d) => ({ ...d, [list]: d[list].filter((v) => v !== id) }));

  const data = preview.data;
  const hasSavedRules = shelf.rules != null && !rulesEqual(shelf.rules, null);

  return (
    <section
      aria-labelledby="shelf-rules-title"
      className="mb-6 space-y-4 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4"
    >
      <div>
        <h2
          id="shelf-rules-title"
          className="text-sm font-medium text-neutral-200"
        >
          {t("shelves.rules.title")}
        </h2>
        <p className="text-xs text-neutral-500">{t("shelves.rules.hint")}</p>
      </div>

      <Field label={t("shelves.rules.types")}>
        <div className="flex gap-1.5">
          {(["movie", "show"] as const).map((type) => (
            <button
              key={type}
              type="button"
              aria-pressed={draft.types.includes(type)}
              onClick={() => toggle("types", type)}
              className={cn(
                "focus-ring rounded-full border px-3 py-1 text-xs",
                draft.types.includes(type)
                  ? "border-primary-400 bg-primary-500/20 text-neutral-100"
                  : "border-neutral-700 text-neutral-400 hover:text-neutral-200",
              )}
            >
              {t(`shelves.type.${type}`)}
            </button>
          ))}
        </div>
        <p className="text-xs text-neutral-500">
          {t("shelves.rules.typesHint")}
        </p>
      </Field>

      <Field label={t("shelves.rules.genresAny")}>
        <GenrePills
          genres={genres}
          selected={draft.genresAny}
          label={t("shelves.rules.genresAny")}
          onToggle={(id) => toggle("genresAny", id)}
        />
      </Field>
      <Field label={t("shelves.rules.genresNone")}>
        <GenrePills
          genres={genres}
          selected={draft.genresNone}
          label={t("shelves.rules.genresNone")}
          onToggle={(id) => toggle("genresNone", id)}
        />
      </Field>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <LookupField
          kind="keywords"
          ids={draft.keywordsAny}
          names={names}
          label={t("shelves.rules.keywordsAny")}
          onAdd={addId("keywordsAny", "keyword")}
          onRemove={removeId("keywordsAny")}
        />
        <LookupField
          kind="keywords"
          ids={draft.keywordsNone}
          names={names}
          label={t("shelves.rules.keywordsNone")}
          onAdd={addId("keywordsNone", "keyword")}
          onRemove={removeId("keywordsNone")}
        />
        <LookupField
          kind="companies"
          ids={draft.companiesAny}
          names={names}
          label={t("shelves.rules.companiesAny")}
          onAdd={addId("companiesAny", "company")}
          onRemove={removeId("companiesAny")}
        />
        <TokenField
          label={t("shelves.rules.networksAny")}
          hint={t("shelves.rules.networksHint")}
          values={draft.networksAny}
          parse={(text) => {
            const n = Number(text);
            return Number.isInteger(n) && n > 0 ? n : null;
          }}
          onChange={(networksAny) => patch({ networksAny })}
        />
        <TokenField
          label={t("shelves.rules.certifications")}
          hint={t("shelves.rules.certificationsHint")}
          values={draft.certifications}
          parse={(text) => (text ? text.toUpperCase().slice(0, 12) : null)}
          onChange={(certifications) => patch({ certifications })}
        />
        <NumberField
          label={t("shelves.rules.collection")}
          value={draft.collection}
          onChange={(collection) => patch({ collection })}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <NumberField
          label={t("shelves.rules.yearMin")}
          value={draft.yearMin}
          onChange={(yearMin) => patch({ yearMin })}
        />
        <NumberField
          label={t("shelves.rules.yearMax")}
          value={draft.yearMax}
          onChange={(yearMax) => patch({ yearMax })}
        />
        <NumberField
          label={t("shelves.rules.votesMin")}
          value={draft.votesMin}
          onChange={(votesMin) => patch({ votesMin })}
        />
        <NumberField
          label={t("shelves.rules.ratingMin")}
          value={draft.ratingMin}
          step="0.1"
          onChange={(ratingMin) => patch({ ratingMin })}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={!dirty || patchShelf.isPending}
          onClick={() =>
            patchShelf.mutate(
              { rules },
              { onSuccess: () => toast.success(t("shelves.rules.saved")) },
            )
          }
        >
          {patchShelf.isPending ? t("shelves.saving") : t("shelves.rules.save")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={rules == null && !hasSavedRules}
          onClick={() => {
            setDraft(emptyRulesDraft());
            if (hasSavedRules) patchShelf.mutate({ rules: null });
          }}
        >
          {t("shelves.rules.clear")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!hasSavedRules || dirty || seed.isPending}
          onClick={() =>
            confirm({
              title: t("shelves.rules.seedTitle"),
              description: t("shelves.rules.seedBody"),
              confirmLabel: t("shelves.rules.seed"),
              onConfirm: () =>
                seed.mutateAsync().then(
                  () => undefined,
                  () => undefined,
                ),
            })
          }
        >
          <Plus size={14} />
          {t("shelves.rules.seed")}
        </Button>
      </div>
      {dirty && hasSavedRules && (
        <p className="text-xs text-neutral-500">
          {t("shelves.rules.saveFirst")}
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm text-neutral-200">
            {t("shelves.rules.autoJoin")}
          </p>
          <p className="text-xs text-neutral-500">
            {hasSavedRules
              ? t("shelves.rules.autoJoinHint")
              : t("shelves.rules.autoJoinNeedsRules")}
          </p>
        </div>
        <Switch
          checked={shelf.auto_join}
          disabled={
            (!hasSavedRules && !shelf.auto_join) || patchShelf.isPending
          }
          aria-label={t("shelves.rules.autoJoin")}
          onCheckedChange={(auto_join) => patchShelf.mutate({ auto_join })}
        />
      </div>

      <div className="space-y-3 border-t border-neutral-800 pt-4">
        <h3 className="text-sm font-medium text-neutral-200">
          {t("shelves.rules.preview")}
        </h3>
        {rules == null ? (
          <p className="text-sm text-neutral-500">
            {t("shelves.rules.previewEmpty")}
          </p>
        ) : preview.isError ? (
          <p className="text-sm text-red-400">
            {t("shelves.rules.previewError")}
          </p>
        ) : !data ? (
          <p className="text-sm text-neutral-500">{t("shelves.searching")}</p>
        ) : (
          <div
            className={cn("space-y-3", preview.isFetching && "opacity-60")}
            aria-busy={preview.isFetching}
          >
            <p className="text-xs text-neutral-500">
              {t("shelves.rules.matches", { count: data.matches.length })}
            </p>
            {data.matches.length > 0 && (
              <ul className="max-h-96 divide-y divide-neutral-800 overflow-y-auto rounded-xl border border-neutral-800">
                {data.matches.map((item) => (
                  <PreviewRow
                    key={`${item.type}-${item.tmdb_id}`}
                    item={item}
                    action={
                      item.in_shelf ? undefined : (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pin.isPending && pin.variables === item}
                          onClick={() => pin.mutate(item)}
                        >
                          {t("shelves.add")}
                        </Button>
                      )
                    }
                  />
                ))}
              </ul>
            )}
            {data.excluded.length > 0 && (
              <>
                <h4 className="text-xs font-medium text-neutral-400">
                  {t("shelves.rules.excluded")}
                </h4>
                <ul className="max-h-72 divide-y divide-neutral-800 overflow-y-auto rounded-xl border border-neutral-800">
                  {data.excluded.map((item) => (
                    <PreviewRow
                      key={`${item.type}-${item.tmdb_id}`}
                      item={item}
                      action={
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={
                            item.in_shelf ||
                            (pin.isPending && pin.variables === item)
                          }
                          onClick={() => pin.mutate(item)}
                        >
                          {t("shelves.rules.pin")}
                        </Button>
                      }
                    />
                  ))}
                </ul>
              </>
            )}
            {data.truncated && (
              <p className="text-xs text-neutral-500">
                {t("shelves.rules.truncated")}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
