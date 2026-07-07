import { useTranslation } from "react-i18next";
import type { DownloadListRow } from "@/features/downloadsImport/hooks/useDownloadsImport";

export function ReleaseDetails({ row }: { row: DownloadListRow }) {
  const { t } = useTranslation("common");
  return (
    <div className="px-4 pb-3 pt-2 text-xs text-neutral-300 space-y-1 bg-white/[0.02]">
      <div>
        <span className="font-semibold text-neutral-100">
          {t("downloadsImport.details.path")}
        </span>{" "}
        <span className="break-all">{row.file_path}</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <span>
          {t("downloadsImport.details.codec")} {row.parsed.codec ?? "—"}
        </span>
        <span>
          {t("downloadsImport.details.hdr")} {row.parsed.hdr ?? "—"}
        </span>
        <span>
          {t("downloadsImport.details.audio")}{" "}
          {(row.parsed.audio ?? []).join(", ") || "—"}
        </span>
        <span>
          {t("downloadsImport.details.subs")}{" "}
          {(row.parsed.subtitles ?? []).join(", ") || "—"}
        </span>
        <span>
          {t("downloadsImport.details.modified")}{" "}
          {new Date(row.modified_at).toLocaleString()}
        </span>
      </div>
      <div>
        {t("downloadsImport.details.detected")} · {row.parsed.kind}
        {" · "}
        {row.parsed.title ?? "—"}
        {row.parsed.year ? ` (${row.parsed.year})` : ""}
        {row.parsed.kind === "tv"
          ? ` · S${row.parsed.season ?? "—"}E${row.parsed.episode ?? "—"}`
          : ""}
      </div>
    </div>
  );
}
