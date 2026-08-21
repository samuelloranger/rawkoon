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
 *
 * The whole edition is the unit, not one file. An audiobook split across tracks
 * that stored only the first would stop playing at the first boundary while the
 * button still claimed it was available.
 */
export const OfflineButton = ({
  fileIds,
  bookId,
  editionId,
}: {
  fileIds: number[];
  bookId: number;
  editionId: number;
}) => {
  const { t } = useTranslation("common");
  const [stored, setStored] = useState(false);
  const [percent, setPercent] = useState<number | null>(null);

  useEffect(() => {
    if (!isOfflineSupported() || fileIds.length === 0) return;
    void listOffline().then((entries) => {
      const cached = new Set(entries.map((entry) => entry.fileId));
      // Partly-stored counts as not stored: the offer has to mean the whole
      // book plays, and re-downloading a cached file is cheap.
      setStored(fileIds.every((id) => cached.has(id)));
    });
  }, [fileIds]);

  if (!isOfflineSupported() || fileIds.length === 0) return null;

  const start = async () => {
    setPercent(0);
    try {
      await downloadForOffline({ fileIds, bookId, editionId }, setPercent);
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
    await removeOffline(fileIds);
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
