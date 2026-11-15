import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { MediaRequest } from "@rawkoon/shared/types";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { PRIMARY_BTN } from "./AddDialogShell";
import { SeasonPicker } from "./SeasonPicker";
import { wantsNewSeasons, type SeasonChoice } from "./seasonPlan";
import { useShowSeasons } from "./useShowSeasons";

/** What the requester asked for; no `season_mode` means every season. */
function requestedChoice(request: MediaRequest): SeasonChoice {
  return {
    mode: request.season_mode ?? "all",
    picked: request.seasons,
    newSeasons: true,
  };
}

function Pills({ choice }: { choice: SeasonChoice }) {
  const { t } = useTranslation("common");
  const pill =
    "rounded-full bg-primary-400/15 px-2.5 py-0.5 text-[13px] text-primary-400";
  return (
    <>
      {choice.mode === "pick" ? (
        choice.picked.map((n) => (
          <span key={n} className={pill}>
            {t("addDialog.seasonLabel", { n })}
          </span>
        ))
      ) : (
        <span className={pill}>{t(`addDialog.modes.${choice.mode}`)}</span>
      )}
      {choice.mode !== "all" && wantsNewSeasons(choice) && (
        <span className={pill}>{t("addDialog.newSeasons")}</span>
      )}
    </>
  );
}

function Panel({
  tmdbId,
  initial,
  onApply,
}: {
  tmdbId: number;
  initial: SeasonChoice;
  onApply: (choice: SeasonChoice) => void;
}) {
  const { t } = useTranslation("common");
  const { seasons, failed } = useShowSeasons(tmdbId);
  const [draft, setDraft] = useState(initial);
  if (!seasons)
    return (
      <p className="text-sm text-neutral-400">
        {failed
          ? t("addDialog.seasonsUnavailable")
          : t("addDialog.loadingSeasons")}
      </p>
    );
  return (
    <div className="space-y-3">
      <SeasonPicker seasons={seasons} choice={draft} onChange={setDraft} />
      <button
        type="button"
        className={`${PRIMARY_BTN} w-full`}
        disabled={draft.mode === "pick" && draft.picked.length === 0}
        onClick={() => onApply(draft)}
      >
        {t("addDialog.apply")}
      </button>
    </div>
  );
}

/** The requested seasons as pills, with a popover where the admin can change them before approving. */
export function RequestSeasonsEditor({
  request,
  override,
  onChange,
  editable,
}: {
  request: MediaRequest;
  override: SeasonChoice | null;
  onChange: (choice: SeasonChoice) => void;
  editable: boolean;
}) {
  const { t } = useTranslation("common");
  const [open, setOpen] = useState(false);
  const shown = override ?? requestedChoice(request);
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <Pills choice={shown} />
      {editable && request.tmdb_id != null && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="focus-ring rounded px-1 py-1.5 text-[13px] font-semibold text-primary-400 hover:underline"
            >
              {t("addDialog.changeSeasons")}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[min(92vw,520px)] p-4">
            <Panel
              tmdbId={request.tmdb_id}
              initial={shown}
              onApply={(c) => {
                onChange(c);
                setOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
