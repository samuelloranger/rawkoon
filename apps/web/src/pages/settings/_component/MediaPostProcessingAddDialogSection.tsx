import { Controller } from "react-hook-form";
import type { Control } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { ToggleRow } from "@/features/add/SeasonPicker";
import { cn } from "@/lib/utils";
import type { MediaSettingsFormValues } from "@/pages/settings/_component/MediaPostProcessingForm";
import { CardSection } from "@/pages/settings/_component/MediaPostProcessingCardParts";

export function MediaPostProcessingAddDialogSection({
  control,
}: {
  control: Control<MediaSettingsFormValues>;
}) {
  const { t } = useTranslation("common");
  return (
    <CardSection title={t("addDialog.settings.title")}>
      <div className="divide-y divide-border">
        <Controller
          control={control}
          name="askBeforeAdding"
          render={({ field }) => (
            <ToggleRow
              title={t("addDialog.settings.ask")}
              hint={t("addDialog.settings.askHint")}
              checked={field.value}
              onChange={field.onChange}
            />
          )}
        />
        <Controller
          control={control}
          name="requestersChooseSeasons"
          render={({ field }) => (
            <ToggleRow
              title={t("addDialog.settings.requesters")}
              hint={t("addDialog.settings.requestersHint")}
              checked={field.value}
              onChange={field.onChange}
            />
          )}
        />
        <div className="py-2.5">
          <div className="font-medium text-neutral-50">
            {t("addDialog.settings.defaultSeasons")}
          </div>
          <div className="text-[13px] text-neutral-400">
            {t("addDialog.settings.defaultSeasonsHint")}
          </div>
          <Controller
            control={control}
            name="defaultSeasonMode"
            render={({ field }) => (
              <div
                role="group"
                aria-label={t("addDialog.settings.defaultSeasons")}
                className="mt-2 flex flex-wrap gap-1.5"
              >
                {(["all", "future", "latest"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={field.value === m}
                    onClick={() => field.onChange(m)}
                    className={cn(
                      "focus-ring rounded-full border px-[13px] py-1.5 text-sm transition-colors",
                      field.value === m
                        ? "border-primary-400 bg-primary-400 font-semibold text-neutral-950"
                        : "border-border text-neutral-100 hover:border-border-strong",
                    )}
                  >
                    {t(`addDialog.modes.${m}`)}
                  </button>
                ))}
              </div>
            )}
          />
        </div>
        <Controller
          control={control}
          name="defaultMonitorNewSeasons"
          render={({ field }) => (
            <ToggleRow
              title={t("addDialog.newSeasons")}
              hint={t("addDialog.settings.newSeasonsHint")}
              checked={field.value}
              onChange={field.onChange}
            />
          )}
        />
      </div>
    </CardSection>
  );
}
