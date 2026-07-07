import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Ban, Trash2 } from "lucide-react";
import { LoadingState } from "@/components/LoadingState";
import { useConfirm } from "@/components/confirm/ConfirmContext";
import { formatDateTime } from "@rawkoon/shared/utils";
import {
  useBlocklist,
  useRemoveFromBlocklist,
} from "@/features/medias/hooks/useBlocklist";
import type { BlocklistEntry } from "@rawkoon/shared/types";

export function BlocklistTab() {
  const { t, i18n } = useTranslation("common");
  const { confirm } = useConfirm();
  const { data, isLoading, error } = useBlocklist();
  const removeMut = useRemoveFromBlocklist();

  const entries = data?.entries ?? [];

  const onUnblock = (entry: BlocklistEntry) => {
    confirm({
      variant: "destructive",
      description: t("settings.blocklist.unblockConfirm", {
        title: entry.release_title,
      }),
      confirmLabel: t("settings.blocklist.unblock"),
      onConfirm: async () => {
        try {
          await removeMut.mutateAsync(entry.id);
          toast.success(t("settings.blocklist.unblockSuccess"));
        } catch (err: unknown) {
          const msg =
            err && typeof err === "object" && "message" in err
              ? String((err as Error).message)
              : t("settings.blocklist.unblockError");
          toast.error(msg);
        }
      },
    });
  };

  return (
    <div className="animate-in fade-in slide-in-from-right-4 duration-300 space-y-6">
      <div className="rounded-xl border border-neutral-700 bg-neutral-800 overflow-hidden">
        <div className="px-6 py-4 border-b border-neutral-700/60 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-neutral-100">
              {t("settings.blocklist.title")}
            </h2>
            <p className="text-xs text-neutral-400 mt-0.5">
              {t("settings.blocklist.description")}
            </p>
          </div>
          {entries.length > 0 && (
            <span className="rounded-full bg-neutral-700 px-2.5 py-0.5 text-xs font-medium text-neutral-300 tabular-nums">
              {entries.length}
            </span>
          )}
        </div>

        <div className="p-4">
          {isLoading ? (
            <LoadingState />
          ) : error ? (
            <p className="text-sm text-red-400 px-2">
              {t("settings.blocklist.loadError")}
            </p>
          ) : entries.length === 0 ? (
            <p className="text-sm text-neutral-500 px-2 py-6 text-center">
              {t("settings.blocklist.empty")}
            </p>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-neutral-700/60 text-xs uppercase tracking-wide text-neutral-500">
                      <th className="px-3 py-2 font-semibold">
                        {t("settings.blocklist.columns.releaseTitle")}
                      </th>
                      <th className="px-3 py-2 font-semibold">
                        {t("settings.blocklist.columns.indexer")}
                      </th>
                      <th className="px-3 py-2 font-semibold">
                        {t("settings.blocklist.columns.reason")}
                      </th>
                      <th className="px-3 py-2 font-semibold">
                        {t("settings.blocklist.columns.blockedAt")}
                      </th>
                      <th className="px-3 py-2 font-semibold text-right">
                        {t("settings.blocklist.columns.actions")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) => (
                      <tr
                        key={entry.id}
                        className="border-b border-neutral-700/40 last:border-0"
                      >
                        <td className="px-3 py-2.5 font-medium text-neutral-100 break-all">
                          {entry.release_title}
                        </td>
                        <td className="px-3 py-2.5 text-neutral-400">
                          {entry.indexer ?? "—"}
                        </td>
                        <td className="px-3 py-2.5 text-neutral-400">
                          {entry.reason ?? "—"}
                        </td>
                        <td className="px-3 py-2.5 text-neutral-400 whitespace-nowrap">
                          {formatDateTime(entry.blocked_at, i18n.language)}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <button
                            type="button"
                            onClick={() => onUnblock(entry)}
                            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-neutral-400 transition-colors hover:bg-red-500/10 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                            title={t("settings.blocklist.unblock")}
                          >
                            <Trash2 size={13} />
                            {t("settings.blocklist.unblock")}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="space-y-2 md:hidden">
                {entries.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-lg border border-neutral-700/60 px-4 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="min-w-0 flex-1 break-all text-sm font-medium text-neutral-100">
                        {entry.release_title}
                      </p>
                      <button
                        type="button"
                        onClick={() => onUnblock(entry)}
                        className="shrink-0 rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-red-500/10 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                        title={t("settings.blocklist.unblock")}
                        aria-label={t("settings.blocklist.unblock")}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <dl className="mt-2 space-y-1 text-xs text-neutral-400">
                      <div className="flex gap-2">
                        <dt className="text-neutral-500">
                          {t("settings.blocklist.columns.indexer")}
                        </dt>
                        <dd>{entry.indexer ?? "—"}</dd>
                      </div>
                      {entry.reason && (
                        <div className="flex gap-2">
                          <dt className="text-neutral-500">
                            {t("settings.blocklist.columns.reason")}
                          </dt>
                          <dd>{entry.reason}</dd>
                        </div>
                      )}
                      <div className="flex gap-2">
                        <dt className="text-neutral-500">
                          {t("settings.blocklist.columns.blockedAt")}
                        </dt>
                        <dd>
                          {formatDateTime(entry.blocked_at, i18n.language)}
                        </dd>
                      </div>
                    </dl>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <p className="flex items-center gap-1.5 px-1 text-xs text-neutral-500">
        <Ban size={12} />
        {t("settings.blocklist.hint")}
      </p>
    </div>
  );
}
