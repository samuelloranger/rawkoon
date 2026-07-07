import { useState } from "react";
import { Lock, Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useUpdateLibraryOverrides } from "@/features/medias/hooks/useUpdateLibraryOverrides";
import type { LibraryMedia } from "@rawkoon/shared/types";
import { Card } from "./LibrarySharedUI";

interface Props {
  libraryId: number;
  item: LibraryMedia;
}

type FormState = {
  title: string;
  sort_title: string;
  year: string;
  overview: string;
  poster_url: string;
};

function fieldKey(field: keyof FormState): string {
  return field;
}

export function LibraryInfoOverridesSection({ libraryId, item }: Props) {
  const { t } = useTranslation("common");
  const [open, setOpen] = useState(false);
  const updateOverrides = useUpdateLibraryOverrides();

  const initialState: FormState = {
    title: item.title ?? "",
    sort_title: item.sort_title ?? "",
    year: item.year != null ? String(item.year) : "",
    overview: item.overview ?? "",
    poster_url: item.poster_url ?? "",
  };

  const [formState, setFormState] = useState<FormState>(initialState);

  const ov = item.overrides ?? {};
  const hasOverride = (field: keyof FormState) =>
    field in ov && ov[field] != null;

  const handleChange = (field: keyof FormState, value: string) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
  };

  const handleClear = async (field: keyof FormState) => {
    try {
      await updateOverrides.mutateAsync({
        id: libraryId,
        overrides: { [fieldKey(field)]: null },
      });
      setFormState((prev) => ({ ...prev, [field]: "" }));
    } catch {
      toast.error(
        t("library.management.editInfo.saveFailed", "Failed to clear field"),
      );
    }
  };

  const handleSave = async () => {
    const payload: Record<string, string | number | null> = {};

    if (formState.title !== initialState.title) {
      payload.title = formState.title || null;
    }
    if (formState.sort_title !== initialState.sort_title) {
      payload.sort_title = formState.sort_title || null;
    }
    if (formState.year !== initialState.year) {
      const parsed = formState.year ? parseInt(formState.year, 10) : null;
      payload.year = isNaN(parsed as number) ? null : parsed;
    }
    if (formState.overview !== initialState.overview) {
      payload.overview = formState.overview || null;
    }
    if (formState.poster_url !== initialState.poster_url) {
      payload.poster_url = formState.poster_url || null;
    }

    if (Object.keys(payload).length === 0) {
      setOpen(false);
      return;
    }

    try {
      await updateOverrides.mutateAsync({ id: libraryId, overrides: payload });
      setOpen(false);
    } catch {
      toast.error(
        t("library.management.editInfo.saveFailed", "Failed to save changes"),
      );
    }
  };

  const inputClass =
    "w-full rounded-lg border border-border bg-neutral-900 px-2.5 py-1.5 text-xs text-neutral-200 focus:outline-none focus:ring-1 focus:ring-primary-500";
  const labelClass = "text-[10px] font-medium text-neutral-400";

  return (
    <Card>
      <button
        type="button"
        onClick={() => {
          if (!open) setFormState(initialState);
          setOpen((v) => !v);
        }}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-neutral-800/40 transition-colors"
      >
        <Pencil size={13} className="text-neutral-400 shrink-0" />
        <span className="text-xs font-semibold text-neutral-200">
          {t("library.management.editInfo.title", "Edit info")}
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <span className={labelClass}>
                {t("library.management.editInfo.fieldTitle", "Title")}
              </span>
              {hasOverride("title") && (
                <Lock size={9} className="text-primary-400" />
              )}
              {hasOverride("title") && (
                <button
                  type="button"
                  onClick={() => void handleClear("title")}
                  className="text-[10px] text-neutral-400 hover:text-rose-400 ml-1 transition-colors"
                >
                  ×
                </button>
              )}
            </div>
            <input
              type="text"
              value={formState.title}
              onChange={(e) => handleChange("title", e.target.value)}
              className={inputClass}
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <span className={labelClass}>
                {t("library.management.editInfo.fieldSortTitle", "Sort title")}
              </span>
              {hasOverride("sort_title") && (
                <Lock size={9} className="text-primary-400" />
              )}
              {hasOverride("sort_title") && (
                <button
                  type="button"
                  onClick={() => void handleClear("sort_title")}
                  className="text-[10px] text-neutral-400 hover:text-rose-400 ml-1 transition-colors"
                >
                  ×
                </button>
              )}
            </div>
            <input
              type="text"
              value={formState.sort_title}
              onChange={(e) => handleChange("sort_title", e.target.value)}
              className={inputClass}
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <span className={labelClass}>
                {t("library.management.editInfo.fieldYear", "Year")}
              </span>
              {hasOverride("year") && (
                <Lock size={9} className="text-primary-400" />
              )}
              {hasOverride("year") && (
                <button
                  type="button"
                  onClick={() => void handleClear("year")}
                  className="text-[10px] text-neutral-400 hover:text-rose-400 ml-1 transition-colors"
                >
                  ×
                </button>
              )}
            </div>
            <input
              type="number"
              value={formState.year}
              onChange={(e) => handleChange("year", e.target.value)}
              className={inputClass}
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <span className={labelClass}>
                {t("library.management.editInfo.fieldOverview", "Overview")}
              </span>
              {hasOverride("overview") && (
                <Lock size={9} className="text-primary-400" />
              )}
              {hasOverride("overview") && (
                <button
                  type="button"
                  onClick={() => void handleClear("overview")}
                  className="text-[10px] text-neutral-400 hover:text-rose-400 ml-1 transition-colors"
                >
                  ×
                </button>
              )}
            </div>
            <textarea
              rows={3}
              value={formState.overview}
              onChange={(e) => handleChange("overview", e.target.value)}
              className={inputClass}
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <span className={labelClass}>
                {t("library.management.editInfo.fieldPosterUrl", "Poster URL")}
              </span>
              {hasOverride("poster_url") && (
                <Lock size={9} className="text-primary-400" />
              )}
              {hasOverride("poster_url") && (
                <button
                  type="button"
                  onClick={() => void handleClear("poster_url")}
                  className="text-[10px] text-neutral-400 hover:text-rose-400 ml-1 transition-colors"
                >
                  ×
                </button>
              )}
            </div>
            <input
              type="text"
              value={formState.poster_url}
              onChange={(e) => handleChange("poster_url", e.target.value)}
              className={inputClass}
            />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Button
              type="button"
              size="sm"
              disabled={updateOverrides.isPending}
              onClick={() => void handleSave()}
            >
              {t("library.management.editInfo.saveButton", "Save changes")}
            </Button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-xs text-neutral-400 hover:text-neutral-300 transition-colors"
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}
