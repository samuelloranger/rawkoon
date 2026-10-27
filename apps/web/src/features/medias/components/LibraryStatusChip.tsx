import { useTranslation } from "react-i18next";
import type { AiringState } from "@rawkoon/shared/types";
import { cn } from "@/lib/utils";
import { displayLibraryStatus } from "@/utils/libraryStatusPresentation";

const STATUS_STYLES: Record<string, string> = {
  wanted: "bg-amber-500/20 text-amber-300",
  downloading: "bg-sky-500/20 text-sky-300",
  upgrading: "bg-sky-500/20 text-sky-300",
  downloaded: "bg-emerald-500/20 text-emerald-300",
};

/** Library state of a title (Missing, Downloading, Downloaded, ...), or a plain "In library" when the status is unknown. */
export function LibraryStatusChip({
  status: storedStatus,
  airingState,
  className,
}: {
  status?: string | null;
  airingState?: AiringState | null;
  className?: string;
}) {
  const { t } = useTranslation("common");
  const status = storedStatus
    ? displayLibraryStatus(storedStatus, airingState)
    : storedStatus;
  const label = status
    ? t(`medias.library.itemStatus.${status}`, { defaultValue: status })
    : t("medias.tmdb.inLibrary");
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
        (status && STATUS_STYLES[status]) ||
          "bg-emerald-500/20 text-emerald-300",
        className,
      )}
    >
      {label}
    </span>
  );
}
