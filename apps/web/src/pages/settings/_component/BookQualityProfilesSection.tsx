import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/dialog";
import { useConfirm } from "@/components/confirm/ConfirmContext";
import type { BookQualityProfile } from "@rawkoon/shared/types";
import {
  useBookQualityProfiles,
  useDeleteBookQualityProfile,
} from "@/pages/books/_hooks/useBooks";
import { ApiError } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { BookQualityProfileForm } from "./BookQualityProfileForm";

type Draft = null | { kind: "create" } | { kind: "edit"; id: number };

/**
 * Book quality profiles.
 *
 * The API has been complete since the profiles shipped, but until now the only
 * way to add or edit one was the configureBooks maintenance script — so a
 * self-hoster without shell access was stuck with the two seeded profiles.
 */
export function BookQualityProfilesSection() {
  const { t } = useTranslation("common");
  const { confirm } = useConfirm();
  const { data, isLoading, error } = useBookQualityProfiles();
  const deleteMut = useDeleteBookQualityProfile();
  const [draft, setDraft] = useState<Draft>(null);

  const profiles = data?.profiles ?? [];
  const editing =
    draft?.kind === "edit"
      ? profiles.find((p) => p.id === draft.id)
      : undefined;

  const onDelete = (profile: BookQualityProfile) => {
    confirm({
      variant: "destructive",
      description: t("settings.bookQualityProfiles.deleteConfirm", {
        name: profile.name,
      }),
      confirmLabel: t("common.delete"),
      onConfirm: async () => {
        try {
          await deleteMut.mutateAsync(profile.id);
          toast.success(t("settings.bookQualityProfiles.deleteSuccess"));
          if (draft?.kind === "edit" && draft.id === profile.id) {
            setDraft(null);
          }
        } catch (e: unknown) {
          toast.error(
            e instanceof ApiError
              ? e.message
              : t("settings.bookQualityProfiles.deleteError"),
          );
        }
      },
    });
  };

  return (
    <div className="overflow-hidden rounded-xl border border-neutral-700 bg-neutral-800">
      <Dialog
        isOpen={draft != null}
        onClose={() => setDraft(null)}
        title={
          draft?.kind === "edit"
            ? t("settings.bookQualityProfiles.editTitle")
            : t("settings.bookQualityProfiles.createTitle")
        }
        bodyScroll
        panelClassName="max-w-2xl"
      >
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden pt-2">
          <p className="shrink-0 text-xs text-neutral-400">
            {t("settings.bookQualityProfiles.formDescription")}
          </p>
          <div className="-mr-1 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
            {/* Keyed so reopening on another profile remounts with its values. */}
            <BookQualityProfileForm
              key={editing ? `${editing.id}-${editing.updated_at}` : "new"}
              initialProfile={editing}
              onDismiss={() => setDraft(null)}
            />
          </div>
        </div>
      </Dialog>

      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-700/60 px-6 py-4">
        <div>
          <h2 className="text-sm font-semibold text-neutral-100">
            {t("settings.bookQualityProfiles.title")}
          </h2>
          <p className="mt-0.5 text-xs text-neutral-400">
            {t("settings.bookQualityProfiles.description")}
          </p>
        </div>
        <Button size="sm" onClick={() => setDraft({ kind: "create" })}>
          {t("settings.bookQualityProfiles.create")}
        </Button>
      </div>

      <div className="p-4">
        {isLoading ? (
          <p className="px-2 py-4 text-center text-sm text-neutral-500">
            {t("common.loading")}
          </p>
        ) : error ? (
          <p className="px-2 text-sm text-red-400">
            {t("settings.bookQualityProfiles.loadError")}
          </p>
        ) : profiles.length === 0 ? (
          <p className="px-2 py-4 text-center text-sm text-neutral-500">
            {t("settings.bookQualityProfiles.empty")}
          </p>
        ) : (
          <div className="space-y-2">
            {profiles.map((p) => (
              <div
                key={p.id}
                className={cn(
                  "flex items-start justify-between gap-4 rounded-lg border px-4 py-3 transition-colors",
                  draft?.kind === "edit" && draft.id === p.id
                    ? "border-primary-700/50 bg-primary-500/5"
                    : "border-neutral-700/60 hover:border-neutral-600",
                )}
              >
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-neutral-100">
                      {p.name}
                    </p>
                    <span className="rounded-md bg-neutral-700 px-1.5 py-0.5 text-xs font-semibold tracking-wide text-neutral-300">
                      {t(`settings.bookQualityProfiles.kinds.${p.kind}`)}
                    </span>
                    {p.prefer_retail && (
                      <span className="rounded-md bg-amber-500/10 px-1.5 py-0.5 text-xs font-medium text-amber-400">
                        {t("settings.bookQualityProfiles.retailPreferred")}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {p.allowed_formats.map((f) => (
                      <span
                        key={f}
                        className={cn(
                          "rounded-md px-1.5 py-0.5 text-xs font-medium",
                          f === p.cutoff_format
                            ? "bg-primary-500/20 text-primary-300"
                            : "bg-primary-500/10 text-primary-400",
                        )}
                      >
                        {f}
                        {f === p.cutoff_format ? " ✓" : ""}
                      </span>
                    ))}
                    {p.min_audio_bitrate != null && (
                      <span className="rounded-md bg-sky-500/10 px-1.5 py-0.5 text-xs font-medium text-sky-400">
                        ≥ {p.min_audio_bitrate} kb/s
                      </span>
                    )}
                    {p.max_size_mb != null && (
                      <span className="rounded-md bg-neutral-700 px-1.5 py-0.5 text-xs font-medium text-neutral-400">
                        ≤ {p.max_size_mb} MB
                      </span>
                    )}
                    {p.min_seeders > 0 && (
                      <span className="rounded-md bg-neutral-700 px-1.5 py-0.5 text-xs font-medium text-neutral-400">
                        ≥ {p.min_seeders} seeders
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      setDraft(
                        draft?.kind === "edit" && draft.id === p.id
                          ? null
                          : { kind: "edit", id: p.id },
                      )
                    }
                    className={cn(
                      "rounded-md p-1.5 transition-colors",
                      draft?.kind === "edit" && draft.id === p.id
                        ? "bg-primary-500/20 text-primary-400"
                        : "text-neutral-400 hover:bg-neutral-700 hover:text-neutral-300",
                    )}
                    title={t("settings.bookQualityProfiles.edit")}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(p)}
                    className="rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-red-500/10 hover:text-red-400"
                    title={t("common.delete")}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
