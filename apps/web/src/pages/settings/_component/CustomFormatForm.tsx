import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FormInput } from "@/components/ui/form-field";
import {
  useCreateCustomFormat,
  useUpdateCustomFormat,
  type CustomFormatFormPayload,
} from "@/pages/settings/useCustomFormats";
import type {
  CustomFormat,
  CustomFormatCondition,
} from "@rawkoon/shared/types";
import { VALIDATION_CODE_KEYS, codeKey } from "@/lib/i18n/scoringCodes";
import { ConditionBuilder } from "@/pages/settings/_component/ConditionBuilder";

const emptyPayload: CustomFormatFormPayload = {
  name: "",
  conditions: [],
};

function formatToForm(cf: CustomFormat): CustomFormatFormPayload {
  return {
    name: cf.name,
    conditions: [...cf.conditions],
  };
}

export function CustomFormatForm({
  editingId,
  initialFormat,
  onDismiss,
}: {
  editingId: number | null;
  initialFormat: CustomFormat | undefined;
  onDismiss: () => void;
}) {
  const { t } = useTranslation("common");
  const createMut = useCreateCustomFormat();
  const updateMut = useUpdateCustomFormat();
  const [form, setForm] = useState<CustomFormatFormPayload>(() =>
    initialFormat ? formatToForm(initialFormat) : emptyPayload,
  );
  const [apiError, setApiError] = useState<string | null>(null);

  const isEditing = editingId != null;
  const busy = createMut.isPending || updateMut.isPending;

  const handleConditionsChange = (conditions: CustomFormatCondition[]) => {
    setForm((prev) => ({ ...prev, conditions }));
  };

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setApiError(null);

    if (!form.name.trim()) {
      toast.error(t("customFormats.nameRequired"));
      return;
    }

    try {
      if (editingId != null) {
        await updateMut.mutateAsync({ id: editingId, body: form });
        toast.success(t("customFormats.updateSuccess"));
      } else {
        await createMut.mutateAsync(form);
        toast.success(t("customFormats.createSuccess"));
      }
      onDismiss();
    } catch (err: unknown) {
      const raw =
        err && typeof err === "object" && "message" in err
          ? String((err as Error).message)
          : "";
      // Try to map a known validation code, fall back to the raw message or a generic error
      const mapped = raw
        ? t(codeKey(VALIDATION_CODE_KEYS, raw), { defaultValue: raw })
        : t("customFormats.saveError");
      setApiError(mapped || t("customFormats.saveError"));
    }
  };

  return (
    <form onSubmit={onSave} className="space-y-5">
      <FormInput
        label={t("customFormats.namePlaceholder")}
        value={form.name}
        onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
        placeholder={t("customFormats.namePlaceholder")}
      />

      <div>
        <ConditionBuilder
          conditions={form.conditions}
          onChange={handleConditionsChange}
        />
      </div>

      {apiError && <p className="text-sm text-red-400">{apiError}</p>}

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
          {t("settings.qualityProfiles.cancelEdit")}
        </Button>
        <Button type="submit" size="sm" disabled={busy}>
          {isEditing
            ? t("settings.qualityProfiles.save")
            : t("customFormats.newFormat")}
        </Button>
      </div>
    </form>
  );
}
