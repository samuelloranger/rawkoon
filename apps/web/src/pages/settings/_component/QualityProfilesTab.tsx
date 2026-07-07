import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";
import { LoadingState } from "@/components/LoadingState";
import { Button } from "@/components/ui/button";
import {
  useDeleteQualityProfile,
  useQualityProfilesList,
} from "@/pages/settings/useQualityProfiles";
import type { QualityProfile } from "@rawkoon/shared/types";
import { cn } from "@/lib/utils";
import { LANGUAGE_OPTIONS } from "./QualityProfileForm";
import {
  QualityProfileEditorModal,
  type QualityProfileDraft,
} from "./QualityProfileEditorModal";
import { useConfirm } from "@/components/confirm/ConfirmContext";

export function QualityProfilesTab() {
  const { t } = useTranslation("common");
  const { confirm } = useConfirm();
  const { data, isLoading, error } = useQualityProfilesList();
  const deleteMut = useDeleteQualityProfile();
  const [draft, setDraft] = useState<QualityProfileDraft>(null);

  const onDelete = async (p: QualityProfile) => {
    confirm({
      variant: "destructive",
      description: t("settings.qualityProfiles.deleteConfirm", {
        name: p.name,
      }),
      confirmLabel: t("common.delete"),
      onConfirm: async () => {
        try {
          await deleteMut.mutateAsync(p.id);
          toast.success(t("settings.qualityProfiles.deleteSuccess"));
          if (draft?.kind === "edit" && draft.id === p.id) {
            setDraft(null);
          }
        } catch (err: unknown) {
          const msg =
            err && typeof err === "object" && "message" in err
              ? String((err as Error).message)
              : t("settings.qualityProfiles.deleteError");
          toast.error(msg);
        }
      },
    });
  };

  const profiles = data?.profiles ?? [];

  return (
    <div className="animate-in fade-in slide-in-from-right-4 duration-300 space-y-6">
      <QualityProfileEditorModal
        draft={draft}
        profiles={profiles}
        onClose={() => setDraft(null)}
      />

      {/* ── List ───────────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-neutral-700 bg-neutral-800 overflow-hidden">
        <div className="px-6 py-4 border-b border-neutral-700/60 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-neutral-100">
              {t("settings.qualityProfiles.listTitle")}
            </h2>
            <p className="text-xs text-neutral-400 mt-0.5">
              {t("settings.qualityProfiles.listDescription")}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" onClick={() => setDraft({ kind: "create" })}>
              {t("settings.qualityProfiles.create")}
            </Button>
            {profiles.length > 0 && (
              <span className="rounded-full bg-neutral-700 px-2.5 py-0.5 text-xs font-medium text-neutral-300 tabular-nums">
                {profiles.length}
              </span>
            )}
          </div>
        </div>

        <div className="p-4">
          {isLoading ? (
            <LoadingState />
          ) : error ? (
            <p className="text-sm text-red-400 px-2">
              {t("settings.qualityProfiles.loadError")}
            </p>
          ) : profiles.length === 0 ? (
            <p className="text-sm text-neutral-500 px-2 py-4 text-center">
              {t("settings.qualityProfiles.empty")}
            </p>
          ) : (
            <div className="space-y-2">
              {profiles.map((p) => (
                <div
                  key={p.id}
                  className={cn(
                    "rounded-lg border px-4 py-3 flex items-start justify-between gap-4 transition-colors",
                    draft?.kind === "edit" && draft.id === p.id
                      ? "border-primary-700/50 bg-primary-500/5"
                      : "border-neutral-700/60 hover:border-neutral-600",
                  )}
                >
                  <div className="min-w-0 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-neutral-100">
                        {p.name}
                      </p>
                      <span className="rounded-md bg-neutral-700 px-1.5 py-0.5 text-xs font-semibold tracking-wide text-neutral-300">
                        {p.min_resolution}p
                        {p.cutoff_resolution ? `→${p.cutoff_resolution}p` : ""}
                      </span>
                      {p.require_hdr && (
                        <span className="rounded-md bg-amber-500/20 px-1.5 py-0.5 text-xs font-medium text-amber-300">
                          {t("settings.qualityProfiles.hdrRequired")}
                        </span>
                      )}
                      {!p.require_hdr && p.prefer_hdr && (
                        <span className="rounded-md bg-amber-500/10 px-1.5 py-0.5 text-xs font-medium text-amber-400">
                          {t("settings.qualityProfiles.hdrPreferred")}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {p.preferred_sources.map((s) => (
                        <span
                          key={s}
                          className="rounded-md bg-primary-500/10 px-1.5 py-0.5 text-xs font-medium text-primary-400"
                        >
                          {s}
                        </span>
                      ))}
                      {p.preferred_codecs.map((c) => (
                        <span
                          key={c}
                          className="rounded-md bg-sky-500/10 px-1.5 py-0.5 text-xs font-medium text-sky-400"
                        >
                          {c}
                        </span>
                      ))}
                      {p.preferred_languages.map((l) => (
                        <span
                          key={l}
                          className="rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-xs font-medium text-emerald-400"
                        >
                          {LANGUAGE_OPTIONS.find((o) => o.value === l)?.label ??
                            l}
                        </span>
                      ))}
                      {p.max_size_gb != null && (
                        <span className="rounded-md bg-neutral-700 px-1.5 py-0.5 text-xs font-medium text-neutral-400">
                          ≤ {p.max_size_gb} Go
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
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
                      title={t("settings.qualityProfiles.edit")}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => void onDelete(p)}
                      className="rounded-md p-1.5 text-neutral-400 hover:bg-red-500/10 hover:text-red-400 transition-colors"
                      title={t("settings.qualityProfiles.delete")}
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
    </div>
  );
}
