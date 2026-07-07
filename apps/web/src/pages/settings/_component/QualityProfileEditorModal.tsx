import { useTranslation } from "react-i18next";
import { Dialog } from "@/components/dialog";
import type { QualityProfile } from "@rawkoon/shared/types";
import { QualityProfileForm } from "./QualityProfileForm";

export type QualityProfileDraft =
  | null
  | { kind: "create" }
  | { kind: "edit"; id: number };

function editorKeyFromDraft(
  draft: QualityProfileDraft,
  profiles: QualityProfile[],
) {
  if (draft?.kind !== "edit") return "new";
  const row = profiles.find((x) => x.id === draft.id);
  return row ? `${draft.id}-${row.updated_at}` : `${draft.id}-pending`;
}

interface QualityProfileEditorModalProps {
  draft: QualityProfileDraft;
  profiles: QualityProfile[];
  onClose: () => void;
}

export function QualityProfileEditorModal({
  draft,
  profiles,
  onClose,
}: QualityProfileEditorModalProps) {
  const { t } = useTranslation("common");
  const isOpen = draft != null;

  const editingId = draft?.kind === "edit" ? draft.id : null;
  const initialProfile =
    editingId != null ? profiles.find((x) => x.id === editingId) : undefined;
  const editorKey = editorKeyFromDraft(draft, profiles);

  const title =
    draft?.kind === "edit"
      ? t("settings.qualityProfiles.editTitle")
      : t("settings.qualityProfiles.createTitle");

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
          {t("settings.qualityProfiles.formDescription")}
        </p>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1 -mr-1">
          <QualityProfileForm
            key={editorKey}
            editingId={editingId}
            initialProfile={initialProfile}
            onDismiss={onClose}
          />
        </div>
      </div>
    </Dialog>
  );
}
