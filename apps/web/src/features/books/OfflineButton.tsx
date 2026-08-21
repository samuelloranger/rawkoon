import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Check, CloudDownload, Loader2, Trash2 } from "lucide-react";
import {
  downloadForOffline,
  isOfflineSupported,
  listOffline,
  removeOffline,
} from "@/lib/offline/bookCache";

/**
 * "Make available offline", then "Available offline". Removal is explicit and
 * lives here too: nothing evicts a stored book on its own.
 */
export const OfflineButton = ({ fileId }: { fileId: number }) => {
  const { t } = useTranslation("common");
  const [stored, setStored] = useState(false);
  const [percent, setPercent] = useState<number | null>(null);

  useEffect(() => {
    if (!isOfflineSupported()) return;
    void listOffline().then((entries) =>
      setStored(entries.some((entry) => entry.fileId === fileId)),
    );
  }, [fileId]);

  if (!isOfflineSupported()) return null;

  const start = async () => {
    setPercent(0);
    try {
      await downloadForOffline(fileId, setPercent);
      setStored(true);
      toast.success(t("books.offline.stored"));
    } catch (err) {
      toast.error(
        err instanceof Error && err.message === "quota"
          ? t("books.offline.noSpace")
          : t("books.offline.failed"),
      );
    } finally {
      setPercent(null);
    }
  };

  const remove = async () => {
    await removeOffline(fileId);
    setStored(false);
    toast.success(t("books.offline.removed"));
  };

  if (percent != null) {
    return (
      <span className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-text-muted">
        <Loader2 className="size-4 animate-spin" />
        {t("books.offline.downloading", { percent })}
      </span>
    );
  }

  return stored ? (
    <button
      type="button"
      onClick={remove}
      className="focus-ring group inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-text hover:text-text-strong"
    >
      <Check className="size-4 text-primary-400 group-hover:hidden" />
      <Trash2 className="hidden size-4 group-hover:block" />
      <span className="group-hover:hidden">{t("books.offline.available")}</span>
      <span className="hidden group-hover:inline">
        {t("books.offline.remove")}
      </span>
    </button>
  ) : (
    <button
      type="button"
      onClick={start}
      className="focus-ring inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-text hover:text-text-strong"
    >
      <CloudDownload className="size-4" />
      {t("books.offline.make")}
    </button>
  );
};
