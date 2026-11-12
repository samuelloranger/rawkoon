import { useTranslation } from "react-i18next";
import type { TranscodeJob } from "@rawkoon/shared/types";
import { formatBytes } from "@/features/transcode/format";
import type { useTranscodeJobAction } from "@/features/transcode/hooks";
import { settingsLabel } from "./transcodeTabHelpers";

export function TranscodeQueueTable({
  queued,
  act,
  safe,
  dragId,
  setDragId,
}: {
  queued: TranscodeJob[];
  act: ReturnType<typeof useTranscodeJobAction>;
  safe: (p: Promise<unknown>) => Promise<unknown>;
  dragId: number | null;
  setDragId: (id: number | null) => void;
}) {
  const { t } = useTranslation("common");

  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="font-display text-[17px] font-semibold text-neutral-50">
          {t("transcode.admin.queue")}
        </h2>
        <span className="text-xs text-neutral-500">
          {t("transcode.admin.queueHint")}
        </span>
      </div>
      <section className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
        {queued.length === 0 ? (
          <p className="px-4 py-6 text-sm text-neutral-400">
            {t("transcode.admin.emptyQueue")}
          </p>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-neutral-800 text-left font-mono text-[11px] uppercase text-neutral-500">
                <th className="w-6 px-3 py-2" />
                <th className="px-3 py-2">{t("transcode.admin.cols.item")}</th>
                <th className="px-3 py-2 mobile-max:hidden">
                  {t("transcode.admin.cols.settings")}
                </th>
                <th className="px-3 py-2">{t("transcode.admin.cols.size")}</th>
                <th className="px-3 py-2">{t("transcode.admin.cols.est")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {queued.map((j, i) => (
                <tr
                  key={j.id}
                  data-testid="queue-row"
                  draggable
                  onDragStart={() => setDragId(j.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragId != null && dragId !== j.id)
                      void safe(act.moveBefore(dragId, j.id));
                    setDragId(null);
                  }}
                  className="border-b border-neutral-800 last:border-b-0"
                >
                  <td className="cursor-grab px-3 py-2 tabular-nums text-neutral-500">
                    {i + 1}
                  </td>
                  <td className="px-3 py-2 text-neutral-200">{j.title}</td>
                  <td className="px-3 py-2 text-neutral-400 mobile-max:hidden">
                    {settingsLabel(j)}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {formatBytes(j.source_bytes)}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-emerald-300">
                    {j.estimated_bytes
                      ? `~${formatBytes(j.estimated_bytes)}`
                      : "–"}
                  </td>
                  <td className="whitespace-nowrap px-2 text-right text-neutral-500">
                    <button
                      type="button"
                      aria-label={t("transcode.admin.moveTop")}
                      onClick={() => safe(act.moveTop(j.id))}
                      className="rounded px-1.5 py-1 hover:bg-neutral-950"
                    >
                      ⤒
                    </button>
                    <button
                      type="button"
                      aria-label={t("transcode.admin.remove")}
                      onClick={() => safe(act.cancel(j.id))}
                      className="rounded px-1.5 py-1 hover:bg-neutral-950"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
