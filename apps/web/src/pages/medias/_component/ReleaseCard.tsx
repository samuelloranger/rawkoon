import { useState } from "react";
import { Download, Sparkles, ChevronDown, ChevronUp, Ban } from "lucide-react";
import type { InteractiveReleaseItem } from "@rawkoon/shared/types";
import { formatBytes } from "@/lib/utils/format";
import { Button } from "@/components/ui/button";
import { codeKey, REJECTION_CODE_KEYS } from "@/lib/i18n/scoringCodes";
import { ScoreBreakdownPanel } from "@/pages/medias/_component/ScoreBreakdownPanel";

/** Insert <wbr> after dots so long release titles can wrap on mobile. */
function BreakableTitle({ text }: { text: string }) {
  const parts = text.split(".");
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {i > 0 && "."}
          {i > 0 && <wbr />}
          {part}
        </span>
      ))}
    </>
  );
}

export function ReleaseCard({
  release,
  onDownload,
  onBlock,
  isDownloading,
  isBusy,
  isBlocking = false,
  blocked = false,
  alreadyGrabbed = false,
  isAiPick = false,
  t,
}: {
  release: InteractiveReleaseItem;
  onDownload: () => void;
  onBlock?: () => void;
  isDownloading: boolean;
  isBusy: boolean;
  isBlocking?: boolean;
  blocked?: boolean;
  alreadyGrabbed?: boolean;
  isAiPick?: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const [showBreakdown, setShowBreakdown] = useState(false);
  const grabDisabled =
    isBusy || (!release.download_url && !release.download_token);
  return (
    <div
      className={`rounded-2xl border p-3 transition-colors ${
        release.rejected
          ? "border-amber-700/30 bg-amber-950/20"
          : "border-neutral-700/80 bg-neutral-900/60 hover:bg-neutral-900"
      }`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-snug text-white">
            {release.info_url ? (
              <a
                href={release.info_url}
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors hover:underline hover:text-primary-400"
              >
                <BreakableTitle text={release.title} />
              </a>
            ) : (
              <BreakableTitle text={release.title} />
            )}
          </p>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {isAiPick && (
              <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold bg-violet-500/15 text-violet-300">
                <Sparkles className="h-2.5 w-2.5" />
                AI Pick
              </span>
            )}
            {release.is_complete_series && (
              <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold bg-violet-500/15 text-violet-300">
                Intégrale
              </span>
            )}
            {release.is_season_pack && !release.is_complete_series && (
              <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold bg-violet-500/15 text-violet-300">
                Season pack
              </span>
            )}
            {release.indexer && (
              <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium bg-neutral-800 text-neutral-400">
                {release.indexer}
              </span>
            )}
            {release.size_bytes != null && (
              <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium bg-sky-950/40 text-sky-300">
                {formatBytes(release.size_bytes)}
              </span>
            )}
            {release.parsed_quality && (
              <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium bg-primary-950/40 text-primary-200">
                {[
                  release.parsed_quality.resolution
                    ? `${release.parsed_quality.resolution}p`
                    : null,
                  release.parsed_quality.source,
                  release.parsed_quality.codec,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            )}
            {release.parsed_quality?.hdr && (
              <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold bg-amber-950/40 text-amber-300">
                {release.parsed_quality.hdr}
              </span>
            )}
            {release.freeleech && (
              <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold bg-green-500/15 text-green-300">
                FL
              </span>
            )}
            {release.quality_score != null && (
              <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium bg-emerald-950/40 text-emerald-200">
                {t("medias.interactive.profileScore", {
                  score: release.quality_score,
                })}
              </span>
            )}
            {release.age != null && (
              <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium bg-neutral-800 text-neutral-400">
                {t("medias.interactive.age", { age: release.age })}
              </span>
            )}
            {(release.seeders != null || release.leechers != null) && (
              <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium bg-emerald-950/40 text-emerald-300">
                {t("medias.interactive.seedersLeechers", {
                  seeders: release.seeders ?? "-",
                  leechers: release.leechers ?? "-",
                })}
              </span>
            )}
            {release.languages.length > 0 && (
              <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium bg-violet-950/40 text-violet-300">
                {release.languages.join(", ")}
              </span>
            )}
          </div>

          {release.rejected &&
            release.quality_rejection_reasons != null &&
            release.quality_rejection_reasons.length > 0 && (
              <div className="mt-2 rounded-md px-2 py-1 text-xs bg-amber-900/20 text-amber-400">
                {release.quality_rejection_reasons.map((code) => (
                  <p key={code}>{t(codeKey(REJECTION_CODE_KEYS, code))}</p>
                ))}
              </div>
            )}

          {!release.rejected &&
            release.score_breakdown &&
            !release.score_breakdown.rejected && (
              <>
                <button
                  type="button"
                  onClick={() => setShowBreakdown((v) => !v)}
                  className="mt-2 flex items-center gap-1 text-[10px] font-medium text-violet-400 hover:text-violet-300"
                >
                  {showBreakdown ? (
                    <ChevronUp className="h-3 w-3" />
                  ) : (
                    <ChevronDown className="h-3 w-3" />
                  )}
                  {t("customFormats.scoreBreakdown")}
                </button>
                {showBreakdown && (
                  <ScoreBreakdownPanel breakdown={release.score_breakdown} />
                )}
              </>
            )}
        </div>

        <div className="flex w-full flex-col gap-1.5 sm:w-auto sm:flex-row sm:items-center">
          <Button
            type="button"
            size="sm"
            onClick={onDownload}
            disabled={grabDisabled}
            style={{ touchAction: "manipulation" }}
            className="w-full gap-1.5 shadow-sm sm:w-auto"
          >
            <Download size={11} strokeWidth={2.5} />
            {isDownloading
              ? t("medias.interactive.downloading")
              : alreadyGrabbed
                ? t("medias.interactive.redownload")
                : t("medias.interactive.download")}
          </Button>
          {onBlock && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onBlock}
              disabled={isBlocking || blocked}
              style={{ touchAction: "manipulation" }}
              className="w-full gap-1.5 sm:w-auto"
              title={t("medias.interactive.blockTitle")}
            >
              <Ban size={11} strokeWidth={2.5} />
              {blocked
                ? t("medias.interactive.blocked")
                : t("medias.interactive.block")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
