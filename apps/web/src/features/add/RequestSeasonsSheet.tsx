import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AddDialogShell, PRIMARY_BTN } from "./AddDialogShell";
import { SeasonPicker } from "./SeasonPicker";
import {
  DEFAULT_CHOICE,
  isChoiceValid,
  latestSeason,
  type PlanSeason,
  type SeasonChoice,
} from "./seasonPlan";
import { useShowSeasons } from "./useShowSeasons";
import type { RequestMedia } from "./useAddFlow";

type RequestSeasons = { season_mode: SeasonChoice["mode"]; seasons?: number[] };

/** Label that says how much is being asked for. */
function requestLabelKey(
  choice: SeasonChoice,
  seasons: PlanSeason[],
): { key: string; values?: Record<string, number> } {
  switch (choice.mode) {
    case "all":
      return { key: "addDialog.requestAll" };
    case "future":
      return { key: "addDialog.requestFuture" };
    case "latest":
      return {
        key: "addDialog.requestLatest",
        values: { season: latestSeason(seasons) ?? 0 },
      };
    case "pick":
      return choice.picked.length
        ? {
            key: "addDialog.requestPick",
            values: { count: choice.picked.length },
          }
        : { key: "addDialog.pickASeason" };
  }
}

/** Non-admin show request: the season section alone, no quality choice. */
export function RequestSeasonsSheet({
  media,
  onSubmit,
  onClose,
}: {
  media: RequestMedia;
  onSubmit: (seasons: RequestSeasons) => Promise<boolean>;
  onClose: (sent?: boolean) => void;
}) {
  const { t } = useTranslation("common");
  const seasons = useShowSeasons(media.tmdb_id);
  const [choice, setChoice] = useState<SeasonChoice>(DEFAULT_CHOICE);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const ok = await onSubmit({
      season_mode: choice.mode,
      ...(choice.mode === "pick" ? { seasons: choice.picked } : {}),
    });
    setBusy(false);
    if (ok) onClose(true);
  };
  const label = seasons ? requestLabelKey(choice, seasons) : null;

  return (
    <AddDialogShell
      title={t("addDialog.requestTitle", { title: media.title })}
      subtitle={media.year ? String(media.year) : undefined}
      posterUrl={media.poster_url}
      onClose={() => onClose()}
    >
      {seasons ? (
        <SeasonPicker
          seasons={seasons}
          choice={choice}
          onChange={setChoice}
          showNewSeasons={false}
        />
      ) : (
        <p className="text-sm text-neutral-400">
          {t("addDialog.loadingSeasons")}
        </p>
      )}
      <button
        type="button"
        className={`${PRIMARY_BTN} w-full`}
        disabled={busy || !seasons || !isChoiceValid(choice)}
        onClick={() => void submit()}
      >
        {label ? t(label.key, label.values) : t("addDialog.requestAll")}
      </button>
      <p className="-mt-1 text-center text-[13px] text-neutral-400">
        {t("addDialog.requestNote")}
      </p>
    </AddDialogShell>
  );
}
