import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";
import type { AddToLibraryResponse } from "@rawkoon/shared/types";
import { useMediaPostProcessingSettings } from "@/features/medias/hooks/useMediaPostProcessingSettings";
import { useQualityProfilesList } from "@/pages/settings/useQualityProfiles";
import {
  AddDialogShell,
  FieldLabel,
  GHOST_BTN,
  PRIMARY_BTN,
} from "./AddDialogShell";
import { ProfileSelect } from "./ProfileSelect";
import { SeasonPicker, ToggleRow } from "./SeasonPicker";
import {
  choiceToBody,
  isChoiceValid,
  latestSeason,
  wantsNewSeasons,
  type PlanSeason,
  type SeasonChoice,
} from "./seasonPlan";
import { useShowSeasons } from "./useShowSeasons";
import type { AddBody, AddableTitle } from "./useAddFlow";

interface AddTitleDialogProps {
  item: AddableTitle;
  compact: boolean;
  /** Initial value of "search now". */
  searchNow: boolean;
  onSubmit: (body: AddBody) => Promise<AddToLibraryResponse | null>;
  /** Called with the response when added, with nothing when dismissed. */
  onClose: (response?: AddToLibraryResponse) => void;
}

/** Admin add: quality profile, and for a show which seasons, before the title lands in the library. */
export function AddTitleDialog({
  item,
  compact,
  searchNow,
  onSubmit,
  onClose,
}: AddTitleDialogProps) {
  const { t } = useTranslation("common");
  const { data: settingsData } = useMediaPostProcessingSettings();
  const { data: profilesData } = useQualityProfilesList();
  const settings = settingsData?.settings;
  const profiles = profilesData?.profiles ?? [];
  const isShow = item.media_type === "tv";
  const seasons = useShowSeasons(isShow ? item.tmdb_id : 0);

  const defaultProfile =
    (isShow
      ? settings?.default_show_quality_profile_id
      : settings?.default_movie_quality_profile_id) ?? null;
  // Picks override the defaults, so late-arriving settings still prefill an untouched form.
  const [pickedProfile, setPickedProfile] = useState<number | null>(null);
  const profileId =
    pickedProfile ??
    (profiles.some((p) => p.id === defaultProfile)
      ? defaultProfile
      : (profiles[0]?.id ?? null));
  const [pickedChoice, setChoice] = useState<SeasonChoice | null>(null);
  const choice: SeasonChoice = pickedChoice ?? {
    mode: settings?.default_season_mode ?? "all",
    picked: [],
    newSeasons: settings?.default_monitor_new_seasons ?? true,
  };
  const [pickedSearch, setSearch] = useState<boolean | null>(null);
  const search =
    pickedSearch ?? (searchNow && (settings?.search_on_add ?? true));
  const [expanded, setExpanded] = useState(!compact);
  const [busy, setBusy] = useState(false);

  const valid = isChoiceValid(choice) && (!isShow || seasons !== undefined);
  const submit = async () => {
    setBusy(true);
    const response = await onSubmit({
      ...(profileId != null ? { quality_profile_id: profileId } : {}),
      ...(isShow ? choiceToBody(choice) : {}),
      search_on_add: search,
    });
    setBusy(false);
    if (response) onClose(response);
  };

  const subtitle = [
    item.release_year,
    isShow && seasons
      ? t("addDialog.seasonCount", {
          count: seasons.filter((s) => !s.announced).length,
        })
      : null,
    isShow && seasons?.some((s) => s.announced)
      ? t("addDialog.announcedSeason", {
          n: seasons.find((s) => s.announced)?.number,
        })
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const quality = (
    <div>
      <FieldLabel>{t("addDialog.quality")}</FieldLabel>
      <ProfileSelect
        profiles={profiles}
        value={profileId}
        onChange={setPickedProfile}
        label={t("addDialog.quality")}
        className="h-auto rounded-xl bg-surface-inset py-2.5 font-semibold text-neutral-50"
      />
    </div>
  );

  if (!expanded) {
    return (
      <AddDialogShell
        tray
        title={t("addDialog.title", { title: item.title })}
        subtitle={
          isShow && seasons
            ? t("addDialog.seasonCount", {
                count: seasons.filter((s) => !s.announced).length,
              })
            : undefined
        }
        onClose={onClose}
      >
        <TrayChips
          profiles={profiles}
          profileId={profileId}
          onProfile={setPickedProfile}
          seasons={isShow ? seasons : undefined}
          choice={choice}
          onExpand={() => setExpanded(true)}
        />
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            className={`${GHOST_BTN} flex-1`}
            onClick={() => onClose()}
          >
            {t("addDialog.skip")}
          </button>
          <button
            type="button"
            className={`${PRIMARY_BTN} flex-[2]`}
            disabled={busy || !valid}
            onClick={() => void submit()}
          >
            {t("addDialog.addShort")}
          </button>
        </div>
      </AddDialogShell>
    );
  }

  return (
    <AddDialogShell
      title={t("addDialog.title", { title: item.title })}
      subtitle={subtitle}
      posterUrl={item.poster_url}
      onClose={onClose}
    >
      {quality}
      {isShow && (
        <SeasonSection seasons={seasons} choice={choice} onChange={setChoice} />
      )}
      <div>
        <ToggleRow
          title={t("addDialog.searchNow")}
          hint={t("addDialog.searchNowHint")}
          checked={search}
          onChange={setSearch}
        />
      </div>
      <div className="flex justify-end gap-2.5 border-t border-border pt-4 max-sm:flex-col-reverse">
        <button type="button" className={GHOST_BTN} onClick={() => onClose()}>
          {t("addDialog.cancel")}
        </button>
        <button
          type="button"
          className={PRIMARY_BTN}
          disabled={busy || !valid}
          onClick={() => void submit()}
        >
          {busy ? t("addDialog.adding") : t("addDialog.add")}
        </button>
      </div>
    </AddDialogShell>
  );
}

function SeasonSection({
  seasons,
  choice,
  onChange,
}: {
  seasons: PlanSeason[] | undefined;
  choice: SeasonChoice;
  onChange: (c: SeasonChoice) => void;
}) {
  const { t } = useTranslation("common");
  if (!seasons)
    return (
      <p className="text-sm text-neutral-400">
        {t("addDialog.loadingSeasons")}
      </p>
    );
  const next = seasons.find((s) => s.announced);
  return (
    <SeasonPicker
      seasons={seasons}
      choice={choice}
      onChange={onChange}
      newSeasonsHint={
        next ? t("addDialog.newSeasonsHintNext", { n: next.number }) : undefined
      }
    />
  );
}

function TrayChips({
  profiles,
  profileId,
  onProfile,
  seasons,
  choice,
  onExpand,
}: {
  profiles: { id: number; name: string }[];
  profileId: number | null;
  onProfile: (id: number) => void;
  seasons: PlanSeason[] | undefined;
  choice: SeasonChoice;
  onExpand: () => void;
}) {
  const { t } = useTranslation("common");
  const latest = seasons ? latestSeason(seasons) : null;
  const chip =
    "focus-ring inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-inset px-3 py-[7px] text-sm text-neutral-50";
  const modeLabel =
    choice.mode === "pick"
      ? t("addDialog.chip.pick", { count: choice.picked.length })
      : choice.mode === "latest" && latest != null
        ? t("addDialog.chip.latest", { n: latest })
        : t(`addDialog.chip.${choice.mode}`, {
            plus: wantsNewSeasons(choice) ? t("addDialog.chip.plusNew") : "",
          });
  return (
    <div className="mt-2.5 flex flex-wrap gap-2">
      <ProfileSelect
        profiles={profiles}
        value={profileId}
        onChange={onProfile}
        label={t("addDialog.quality")}
        className={`${chip} h-auto w-auto gap-2 border-l`}
      />
      {seasons && (
        <button type="button" className={chip} onClick={onExpand}>
          {modeLabel}
          <ChevronDown className="size-3.5 opacity-65" />
        </button>
      )}
    </div>
  );
}
