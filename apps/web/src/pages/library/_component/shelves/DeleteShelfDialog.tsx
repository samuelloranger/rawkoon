import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/dialog";

export function DeleteShelfDialog({
  isOpen,
  onClose,
  name,
  pending,
  onConfirm,
}: {
  isOpen: boolean;
  onClose: () => void;
  name: string;
  pending: boolean;
  onConfirm: () => void;
}) {
  const { t } = useTranslation("common");

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title={t("shelves.deleteTitle")}>
      <div className="space-y-4 px-1 pb-2 text-left">
        <p className="text-sm text-neutral-300">
          {t("shelves.deleteBody", { name: name })}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={pending}
            onClick={() => onConfirm()}
          >
            {t("shelves.delete")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
