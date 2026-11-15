import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { LibraryEpisodesResponse } from "@rawkoon/shared/types";
import { useLibraryItem } from "@/features/medias/hooks/useLibraryItem";
import { useSetMonitoredSeasons } from "@/features/medias/hooks/useSetMonitoredSeasons";
import { GHOST_BTN, PRIMARY_BTN } from "./AddDialogShell";
import { SeasonPicker } from "./SeasonPicker";
import {
  choiceToBody,
  isChoiceValid,
  seasonsFromEpisodes,
  todayIso,
  type SeasonChoice,
} from "./seasonPlan";

/** The seasons a show currently monitors, as a pick. */
function currentChoice(
  data: LibraryEpisodesResponse,
  monitorNewSeasons: boolean,
): SeasonChoice {
  const picked = data.seasons
    .filter((s) => s.season > 0 && s.episodes.some((e) => e.monitored))
    .map((s) => s.season)
    .sort((a, b) => a - b);
  return { mode: "pick", picked, newSeasons: monitorNewSeasons };
}

const sameChoice = (a: SeasonChoice, b: SeasonChoice) =>
  a.mode === b.mode &&
  a.newSeasons === b.newSeasons &&
  a.picked.join() === b.picked.join();

function Form({
  libraryId,
  episodes,
  current,
}: {
  libraryId: number;
  episodes: LibraryEpisodesResponse;
  current: SeasonChoice;
}) {
  const { t } = useTranslation("common");
  const save = useSetMonitoredSeasons(libraryId);
  const [draft, setDraft] = useState(current);
  const seasons = useMemo(
    () => seasonsFromEpisodes(episodes, todayIso()),
    [episodes],
  );
  const changed = !sameChoice(draft, current);
  // A flag-only save must not re-monitor partly monitored seasons, so a mode goes along only when it or the picks changed.
  const modeChanged =
    draft.mode !== current.mode ||
    draft.picked.join() !== current.picked.join();
  const next = seasons.find((s) => s.announced);

  const onSave = () =>
    save.mutate(
      modeChanged
        ? choiceToBody(draft)
        : { monitor_new_seasons: draft.newSeasons },
      {
        onSuccess: () => toast.success(t("addDialog.manage.saved")),
        onError: () => toast.error(t("addDialog.manage.saveFailed")),
      },
    );

  return (
    <section className="mb-5 rounded-[18px] border border-border bg-surface-raised px-[22px] py-5">
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-display text-lg font-semibold text-neutral-50">
          {t("addDialog.manage.title")}
        </h3>
        {changed && (
          <div className="flex gap-2">
            <button
              type="button"
              className={`${GHOST_BTN} !px-3.5 !py-2`}
              onClick={() => setDraft(current)}
            >
              {t("addDialog.manage.reset")}
            </button>
            <button
              type="button"
              className={`${PRIMARY_BTN} !px-3.5 !py-2`}
              disabled={
                save.isPending || (modeChanged && !isChoiceValid(draft))
              }
              onClick={onSave}
            >
              {t("addDialog.manage.save")}
            </button>
          </div>
        )}
      </div>
      <SeasonPicker
        seasons={seasons}
        choice={draft}
        onChange={setDraft}
        newSeasonsHint={
          next
            ? t("addDialog.newSeasonsHintNext", { n: next.number })
            : undefined
        }
      />
    </section>
  );
}

/** Show page, Files tab: which seasons are monitored, edited with the same strip as the add dialog. */
export function ManageSeasons({
  libraryId,
  episodes,
}: {
  libraryId: number;
  episodes: LibraryEpisodesResponse;
}) {
  const { data: item } = useLibraryItem(libraryId);
  // Wait for the flag so the draft never starts from a guessed value.
  if (!item) return null;
  const current = currentChoice(
    episodes,
    item.item.monitor_new_seasons ?? true,
  );
  // Remount on server change so a save (or another tab) replaces the draft.
  return (
    <Form
      key={JSON.stringify(current)}
      libraryId={libraryId}
      episodes={episodes}
      current={current}
    />
  );
}
