import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { ShelfDetail, ShelfSeedSummary } from "@rawkoon/shared/types";
import { useFetcher } from "@/lib/api/context";
import { SHELVES_ENDPOINTS } from "@/lib/endpoints";
import { queryKeys } from "@/lib/queryKeys";
import { Dialog } from "@/components/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * New shelf: start empty with a name, or pick one of the shipped recipes, which
 * fills the shelf once and leaves it an ordinary shelf to edit.
 */
export function NewShelfDialog({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation("common");
  const language = (i18n.resolvedLanguage ?? i18n.language).split("-")[0];
  const fetcher = useFetcher();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [seed, setSeed] = useState<string | null>(null);

  const seeds = useQuery({
    queryKey: queryKeys.shelves.seeds(language),
    queryFn: () =>
      fetcher<{ seeds: ShelfSeedSummary[] }>(SHELVES_ENDPOINTS.SEEDS(language)),
    enabled: isOpen,
  });

  const create = useMutation({
    mutationFn: () =>
      fetcher<{ shelf: ShelfDetail }>(SHELVES_ENDPOINTS.CREATE, {
        method: "POST",
        body: seed ? { seed } : { name: name.trim() },
      }),
    onSuccess: async ({ shelf }) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.shelves.all });
      toast.success(t("shelves.created"));
      setName("");
      setSeed(null);
      onClose();
      void navigate({
        to: "/library/shelves/$shelfId",
        params: { shelfId: String(shelf.id) },
      });
    },
    onError: () => toast.error(t("shelves.createError")),
  });

  const canCreate = seed != null || name.trim().length > 0;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={t("shelves.new")}
      bodyScroll
    >
      <div className="space-y-5 px-1 pb-2 text-left">
        <div className="space-y-2">
          <label
            htmlFor="shelf-name"
            className="text-sm font-medium text-neutral-200"
          >
            {t("shelves.name")}
          </label>
          <Input
            id="shelf-name"
            value={name}
            maxLength={120}
            placeholder={t("shelves.namePlaceholder")}
            onChange={(event) => {
              setName(event.target.value);
              if (event.target.value) setSeed(null);
            }}
          />
          <p className="text-xs text-neutral-500">{t("shelves.emptyHint")}</p>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-neutral-200">
            {t("shelves.orSeed")}
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(seeds.data?.seeds ?? []).map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => {
                  setSeed(option.key);
                  setName("");
                }}
                className={cn(
                  "focus-ring rounded-lg border p-3 text-left transition-colors",
                  seed === option.key
                    ? "border-primary-400 bg-primary-500/10"
                    : "border-neutral-700 bg-neutral-800/60 hover:border-neutral-600",
                )}
              >
                <span className="block text-sm font-medium text-neutral-100">
                  {option.name}
                </span>
                <span className="mt-1 block text-xs text-neutral-400">
                  {option.description}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            size="sm"
            disabled={!canCreate || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? t("shelves.creating") : t("shelves.create")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
