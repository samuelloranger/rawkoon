import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";
import { LoadingState } from "@/components/LoadingState";
import { Button } from "@/components/ui/button";
import {
  useCustomFormatsList,
  useDeleteCustomFormat,
} from "@/pages/settings/useCustomFormats";
import type {
  CustomFormat,
  CustomFormatCondition,
} from "@rawkoon/shared/types";
import { cn } from "@/lib/utils";
import {
  CONDITION_TYPE_KEYS,
  OPERATOR_KEYS,
  codeKey,
} from "@/lib/i18n/scoringCodes";
import {
  CustomFormatEditorModal,
  type CustomFormatDraft,
} from "./CustomFormatEditorModal";
import { useConfirm } from "@/components/confirm/ConfirmContext";

function ConditionSummary({
  conditions,
}: {
  conditions: CustomFormatCondition[];
}) {
  const { t } = useTranslation("common");

  if (conditions.length === 0) return null;

  const parts = conditions.slice(0, 3).map((c) => {
    const typeLabel = t(codeKey(CONDITION_TYPE_KEYS, c.type));
    const opLabel = t(codeKey(OPERATOR_KEYS, c.operator));
    const valueStr = Array.isArray(c.value)
      ? `${c.value[0]}–${c.value[1]}`
      : c.value !== undefined
        ? String(c.value)
        : "";
    const negated = c.negate ? "!" : "";
    const parts = [negated + typeLabel];
    if (c.operator !== "is_true") parts.push(opLabel);
    if (valueStr) parts.push(valueStr);
    return parts.join(" ");
  });

  return (
    <p className="text-xs text-neutral-400 truncate">
      {parts.join(" · ")}
      {conditions.length > 3 && (
        <span className="ml-1 text-neutral-500">+{conditions.length - 3}</span>
      )}
    </p>
  );
}

export function CustomFormatsTab() {
  const { t } = useTranslation("common");
  const { confirm } = useConfirm();
  const { data, isLoading, error } = useCustomFormatsList();
  const deleteMut = useDeleteCustomFormat();
  const [draft, setDraft] = useState<CustomFormatDraft>(null);

  const onDelete = async (cf: CustomFormat) => {
    confirm({
      variant: "destructive",
      description: t("customFormats.deleteConfirm", { name: cf.name }),
      confirmLabel: t("common.delete"),
      onConfirm: async () => {
        try {
          await deleteMut.mutateAsync(cf.id);
          toast.success(t("customFormats.deleteSuccess"));
          if (draft?.kind === "edit" && draft.id === cf.id) {
            setDraft(null);
          }
        } catch (err: unknown) {
          const msg =
            err && typeof err === "object" && "message" in err
              ? String((err as Error).message)
              : t("customFormats.deleteError");
          toast.error(msg);
        }
      },
    });
  };

  const formats = data?.custom_formats ?? [];

  return (
    <div className="animate-in fade-in slide-in-from-right-4 duration-300 space-y-6">
      <CustomFormatEditorModal
        draft={draft}
        formats={formats}
        onClose={() => setDraft(null)}
      />

      {/* ── List ───────────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-neutral-700 bg-neutral-800 overflow-hidden">
        <div className="px-6 py-4 border-b border-neutral-700/60 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-neutral-100">
              {t("customFormats.title")}
            </h2>
            <p className="text-xs text-neutral-400 mt-0.5">
              {t("customFormats.description")}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" onClick={() => setDraft({ kind: "create" })}>
              {t("customFormats.newFormat")}
            </Button>
            {formats.length > 0 && (
              <span className="rounded-full bg-neutral-700 px-2.5 py-0.5 text-xs font-medium text-neutral-300 tabular-nums">
                {formats.length}
              </span>
            )}
          </div>
        </div>

        <div className="p-4">
          {isLoading ? (
            <LoadingState />
          ) : error ? (
            <p className="text-sm text-red-400 px-2">
              {t("customFormats.loadError")}
            </p>
          ) : formats.length === 0 ? (
            <p className="text-sm text-neutral-500 px-2 py-4 text-center">
              {t("customFormats.empty")}
            </p>
          ) : (
            <div className="space-y-2">
              {formats.map((cf) => (
                <div
                  key={cf.id}
                  className={cn(
                    "rounded-lg border px-4 py-3 flex items-start justify-between gap-4 transition-colors",
                    draft?.kind === "edit" && draft.id === cf.id
                      ? "border-primary-700/50 bg-primary-500/5"
                      : "border-neutral-700/60 hover:border-neutral-600",
                  )}
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-neutral-100">
                        {cf.name}
                      </p>
                      <span className="rounded-md bg-neutral-700 px-1.5 py-0.5 text-xs font-semibold tracking-wide text-neutral-300">
                        {cf.conditions.length} {t("customFormats.conditions")}
                      </span>
                    </div>
                    <ConditionSummary conditions={cf.conditions} />
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        setDraft(
                          draft?.kind === "edit" && draft.id === cf.id
                            ? null
                            : { kind: "edit", id: cf.id },
                        )
                      }
                      className={cn(
                        "rounded-md p-1.5 transition-colors",
                        draft?.kind === "edit" && draft.id === cf.id
                          ? "bg-primary-500/20 text-primary-400"
                          : "text-neutral-400 hover:bg-neutral-700 hover:text-neutral-300",
                      )}
                      title={t("customFormats.editFormat")}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => void onDelete(cf)}
                      className="rounded-md p-1.5 text-neutral-400 hover:bg-red-500/10 hover:text-red-400 transition-colors"
                      title={t("customFormats.deleteFormat")}
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
