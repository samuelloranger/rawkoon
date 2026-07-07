import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Globe2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader } from "@/components/Loader";
import {
  useAppSettings,
  useUpdateAppSettings,
} from "@/pages/settings/useAppSettings";
import { getCountryOptions } from "@/lib/countriesDisplay";
import { SettingsPageHeader } from "@/pages/settings/_component/SettingsPageHeader";

const LANGUAGE_OPTIONS = [
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "es", label: "Español" },
  { code: "it", label: "Italiano" },
  { code: "pt", label: "Português" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
];

const WINDOW_OPTIONS = [
  { value: 3, label: "3 months" },
  { value: 6, label: "6 months" },
  { value: 12, label: "1 year" },
  { value: 24, label: "2 years" },
] as const;

export function GeneralSettingsTab() {
  const { t, i18n } = useTranslation("common");
  const { data, isLoading, error } = useAppSettings();
  const updateMut = useUpdateAppSettings();

  const generalSettingsSchema = useMemo(
    () =>
      z.object({
        countryCode: z.string(),
        upcomingWindowMonths: z.union([
          z.literal(3),
          z.literal(6),
          z.literal(12),
          z.literal(24),
        ]),
        selectedLanguages: z
          .array(z.string())
          .min(1, t("settings.general.languageRequired")),
      }),
    [t],
  );

  type GeneralSettingsFormValues = z.infer<typeof generalSettingsSchema>;

  const {
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<GeneralSettingsFormValues>({
    resolver: zodResolver(generalSettingsSchema),
    defaultValues: {
      countryCode: "US",
      upcomingWindowMonths: 12,
      selectedLanguages: ["en", "fr"],
    },
  });

  // react-hook-form's watch() opts this component out of React Compiler.
  // eslint-disable-next-line react-hooks/incompatible-library
  const countryCode = watch("countryCode");
  const upcomingWindowMonths = watch("upcomingWindowMonths");
  const selectedLanguages = watch("selectedLanguages");

  const sortedCountryOptions = useMemo(
    () => getCountryOptions(i18n.language),
    [i18n.language],
  );

  const countryLabel =
    sortedCountryOptions.find((option) => option.code === countryCode)?.label ??
    countryCode;

  useEffect(() => {
    if (!data?.settings) return;
    reset({
      countryCode: data.settings.country_code,
      upcomingWindowMonths: data.settings
        .upcoming_window_months as GeneralSettingsFormValues["upcomingWindowMonths"],
      selectedLanguages: (data.settings.upcoming_languages ?? "en,fr").split(
        ",",
      ),
    });
  }, [data?.settings, reset]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-neutral-500">
        <Loader size="md" />
        <span className="text-sm">{t("settings.general.loading")}</span>
      </div>
    );
  }

  if (error || !data?.settings) {
    return (
      <p className="text-sm text-red-400">{t("settings.general.loadError")}</p>
    );
  }

  const toggleLanguage = (code: string) => {
    const current = selectedLanguages ?? [];
    if (current.includes(code)) {
      setValue(
        "selectedLanguages",
        current.filter((lang) => lang !== code),
        { shouldValidate: true },
      );
    } else {
      setValue("selectedLanguages", [...current, code], {
        shouldValidate: true,
      });
    }
  };

  const onSubmit = async (formData: GeneralSettingsFormValues) => {
    try {
      await updateMut.mutateAsync({
        country_code: formData.countryCode,
        upcoming_window_months: formData.upcomingWindowMonths,
        upcoming_languages: formData.selectedLanguages.join(","),
      });
      toast.success(t("settings.general.saveSuccess"));
    } catch {
      toast.error(t("settings.general.saveError"));
    }
  };

  return (
    <form className="space-y-8" onSubmit={handleSubmit(onSubmit)}>
      <SettingsPageHeader
        icon={Globe2}
        title={t("settings.general.title")}
        description={t("settings.general.description")}
      />

      {/* Region Settings */}
      <section className="space-y-4 rounded-xl border p-6 border-neutral-700 bg-neutral-800">
        <h3 className="text-sm font-semibold text-neutral-100">Region</h3>
        <div className="max-w-md space-y-4">
          <div>
            <label className="block text-sm font-medium text-neutral-300 mb-2">
              {t("settings.general.countryCode")}
            </label>
            <Select
              value={countryCode}
              onValueChange={(value) => setValue("countryCode", value)}
            >
              <SelectTrigger>
                <SelectValue>{countryLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent className="max-h-72 overflow-y-auto">
                {sortedCountryOptions.map(({ code, label }) => (
                  <SelectItem key={code} value={code}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <p className="mt-1 text-xs text-neutral-400">
            {t("settings.general.countryCodeHint")}
          </p>
        </div>
      </section>

      {/* Upcoming Media Settings */}
      <section className="space-y-4 rounded-xl border p-6 border-neutral-700 bg-neutral-800">
        <h3 className="text-sm font-semibold text-neutral-100">
          Upcoming Releases
        </h3>
        <div className="max-w-md space-y-4">
          <div>
            <label className="block text-sm font-medium text-neutral-300 mb-2">
              Look-ahead window
            </label>
            <Select
              value={String(upcomingWindowMonths)}
              onValueChange={(value) =>
                setValue(
                  "upcomingWindowMonths",
                  parseInt(
                    value,
                    10,
                  ) as GeneralSettingsFormValues["upcomingWindowMonths"],
                )
              }
            >
              <SelectTrigger>
                <SelectValue>
                  {
                    WINDOW_OPTIONS.find((w) => w.value === upcomingWindowMonths)
                      ?.label
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {WINDOW_OPTIONS.map((w) => (
                  <SelectItem key={w.value} value={String(w.value)}>
                    {w.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-neutral-400">
              How far ahead to show upcoming movies and TV releases
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-300 mb-3">
              Languages to include
            </label>
            <div className="space-y-2">
              {LANGUAGE_OPTIONS.map((lang) => (
                <label
                  key={lang.code}
                  className="flex items-center gap-2 cursor-pointer hover:bg-neutral-700/50 p-2 rounded-md"
                >
                  <Checkbox
                    checked={selectedLanguages.includes(lang.code)}
                    onChange={() => toggleLanguage(lang.code)}
                  />
                  <span className="text-sm text-neutral-300">{lang.label}</span>
                </label>
              ))}
            </div>
            {errors.selectedLanguages && (
              <p className="mt-1 text-sm text-red-400">
                {errors.selectedLanguages.message}
              </p>
            )}
            <p className="mt-2 text-xs text-neutral-400">
              Select which languages to include in release searches
            </p>
          </div>
        </div>
      </section>

      <Button type="submit" disabled={updateMut.isPending}>
        {updateMut.isPending
          ? t("settings.general.saving")
          : t("settings.general.save")}
      </Button>
    </form>
  );
}
