import { useTranslation } from "react-i18next";
import { Dialog } from "@/components/dialog";
import type { CustomFormat } from "@rawkoon/shared/types";
import { CustomFormatForm } from "./CustomFormatForm";

export type CustomFormatDraft =
  | null
  | { kind: "create" }
  | { kind: "edit"; id: number };

function editorKeyFromDraft(draft: CustomFormatDraft, formats: CustomFormat[]) {
  if (draft?.kind !== "edit") return "new";
  const row = formats.find((x) => x.id === draft.id);
  return row ? `${draft.id}-${row.updated_at}` : `${draft.id}-pending`;
}

interface CustomFormatEditorModalProps {
  draft: CustomFormatDraft;
  formats: CustomFormat[];
  onClose: () => void;
}

export function CustomFormatEditorModal({
  draft,
  formats,
  onClose,
}: CustomFormatEditorModalProps) {
  const { t } = useTranslation("common");
  const isOpen = draft != null;

  const editingId = draft?.kind === "edit" ? draft.id : null;
  const initialFormat =
    editingId != null ? formats.find((x) => x.id === editingId) : undefined;
  const editorKey = editorKeyFromDraft(draft, formats);

  const title =
    draft?.kind === "edit"
      ? t("customFormats.editTitle")
      : t("customFormats.createTitle");

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      bodyScroll
      panelClassName="max-w-3xl"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 pt-2 overflow-hidden">
        <p className="text-xs text-neutral-400 shrink-0">
          {t("customFormats.formDescription")}
        </p>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1 -mr-1">
          <CustomFormatForm
            key={editorKey}
            editingId={editingId}
            initialFormat={initialFormat}
            onDismiss={onClose}
          />
        </div>
      </div>
    </Dialog>
  );
}
