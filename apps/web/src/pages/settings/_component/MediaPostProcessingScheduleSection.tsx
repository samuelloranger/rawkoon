import { Controller } from "react-hook-form";
import type { Control } from "react-hook-form";
import { useTranslation } from "react-i18next";
import {
  DEFAULT_RSS_POLL_INTERVAL_MINUTES,
  RSS_POLL_INTERVAL_MINUTES,
} from "@rawkoon/shared/utils";
import {
  ReleaseCheckFieldset,
  type ReleaseCheckValue,
} from "@/pages/settings/_component/ReleaseCheckFieldset";
import {
  LABEL_CLASS,
  SELECT_CLASS,
  type MediaSettingsFormValues,
} from "@/pages/settings/_component/MediaPostProcessingForm";
import { CardSection } from "@/pages/settings/_component/MediaPostProcessingCardParts";

export function MediaPostProcessingScheduleSection({
  control,
  initialCron,
  jackettActive,
  onReleaseCheckChange,
}: {
  control: Control<MediaSettingsFormValues>;
  initialCron: string;
  jackettActive: boolean;
  onReleaseCheckChange: (value: ReleaseCheckValue) => void;
}) {
  const { t } = useTranslation("common");
  return (
    <CardSection title={t("settings.library.schedule.title")}>
      <ReleaseCheckFieldset
        initialCron={initialCron}
        onChange={onReleaseCheckChange}
      />
      <div>
        <label
          htmlFor="media-post-processing-settings-body-rss-poll-interval"
          className={LABEL_CLASS}
        >
          {t("settings.mediaLibrary.rssPoll.title")}
        </label>
        <Controller
          control={control}
          name="rssPollIntervalMinutes"
          render={({ field }) => (
            <select
              id="media-post-processing-settings-body-rss-poll-interval"
              {...field}
              className={SELECT_CLASS}
            >
              {RSS_POLL_INTERVAL_MINUTES.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes === DEFAULT_RSS_POLL_INTERVAL_MINUTES
                    ? t("settings.mediaLibrary.rssPoll.optionDefault", {
                        count: minutes,
                      })
                    : t("settings.mediaLibrary.rssPoll.option", {
                        count: minutes,
                      })}
                </option>
              ))}
            </select>
          )}
        />
        <p className="mt-1.5 text-xs text-neutral-400">
          {t("settings.mediaLibrary.rssPoll.description")}
        </p>
        {jackettActive && (
          <p className="mt-1.5 text-xs text-amber-300/90">
            {t("settings.mediaLibrary.rssPoll.jackettCache")}
          </p>
        )}
      </div>
    </CardSection>
  );
}
