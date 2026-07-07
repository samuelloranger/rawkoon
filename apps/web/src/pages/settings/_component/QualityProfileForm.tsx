import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormInput } from "@/components/ui/form-field";
import {
  profileToForm,
  useCreateQualityProfile,
  useUpdateQualityProfile,
  type QualityProfileFormPayload,
} from "@/pages/settings/useQualityProfiles";
import type { QualityProfile } from "@rawkoon/shared/types";
import { cn } from "@/lib/utils";
import { MultiSelect } from "./QualityProfileMultiSelect";
import { TrackerPrioritySection } from "./QualityProfileTrackerSection";
import { CustomFormatAssignmentEditor } from "./CustomFormatAssignmentEditor";

// ─── Option definitions ───────────────────────────────────────────────────────

const SOURCE_OPTIONS = [
  { value: "REMUX", label: "REMUX" },
  { value: "BluRay", label: "Blu-ray" },
  { value: "WEB-DL", label: "WEB-DL" },
  { value: "WEBRip", label: "WEBRip" },
  { value: "HDTV", label: "HDTV" },
];

const CODEC_OPTIONS = [
  { value: "HEVC", label: "HEVC / x265" },
  { value: "AVC", label: "AVC / x264" },
  { value: "AV1", label: "AV1" },
  { value: "VP9", label: "VP9" },
];

export const LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "fr", label: "Français (générique)" },
  { value: "VFF", label: "VFF — Français (France)" },
  { value: "VFQ", label: "VFQ — Français (Québec)" },
  { value: "VF2", label: "VF2 — Dual French" },
  { value: "VFI", label: "VFI — Français (International)" },
  { value: "TRUEFRENCH", label: "TRUEFRENCH" },
  { value: "de", label: "Deutsch" },
  { value: "es", label: "Español" },
  { value: "it", label: "Italiano" },
  { value: "ja", label: "日本語" },
  { value: "pt", label: "Português" },
];

// ─── Field label ──────────────────────────────────────────────────────────────

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="text-sm font-medium text-neutral-300">{children}</label>
  );
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const emptyPayload: QualityProfileFormPayload = {
  name: "",
  min_resolution: 1080,
  preferred_sources: [],
  preferred_codecs: [],
  preferred_languages: [],
  prioritized_trackers: [],
  prefer_tracker_over_quality: false,
  max_size_gb: null,
  require_hdr: false,
  prefer_hdr: false,
  cutoff_resolution: null,
  min_seeders: 0,
  custom_formats: [],
};

const selectClass =
  "w-full rounded-lg border px-3 py-2 text-sm border-neutral-700 bg-neutral-900 text-neutral-100 focus:outline-none focus:ring-2 focus:ring-primary-500/30 transition-colors";

// ─── Form (remounted via key when editing target / server row changes) ─────────

export function QualityProfileForm({
  editingId,
  initialProfile,
  onDismiss,
}: {
  editingId: number | null;
  initialProfile: QualityProfile | undefined;
  onDismiss: () => void;
}) {
  const { t } = useTranslation("common");
  const createMut = useCreateQualityProfile();
  const updateMut = useUpdateQualityProfile();
  const [form, setForm] = useState<QualityProfileFormPayload>(() =>
    initialProfile ? profileToForm(initialProfile) : emptyPayload,
  );

  const set = <K extends keyof QualityProfileFormPayload>(
    key: K,
    value: QualityProfileFormPayload[K],
  ) => setForm((prev) => ({ ...prev, [key]: value }));

  const isEditing = editingId != null;
  const busy = createMut.isPending || updateMut.isPending;

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error(t("settings.qualityProfiles.nameRequired"));
      return;
    }
    try {
      if (editingId != null) {
        await updateMut.mutateAsync({ id: editingId, body: form });
        toast.success(t("settings.qualityProfiles.updateSuccess"));
      } else {
        await createMut.mutateAsync(form);
        toast.success(t("settings.qualityProfiles.createSuccess"));
      }
      onDismiss();
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? String((err as Error).message)
          : t("settings.qualityProfiles.saveError");
      toast.error(msg);
    }
  };

  return (
    <form onSubmit={onSave} className="space-y-5">
      <FormInput
        label={t("settings.qualityProfiles.name")}
        value={form.name}
        onChange={(e) => set("name", e.target.value)}
        placeholder="ex. Cinéma 1080p FR"
      />

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <FieldLabel>{t("settings.qualityProfiles.minResolution")}</FieldLabel>
          <select
            value={form.min_resolution}
            onChange={(e) => set("min_resolution", Number(e.target.value))}
            className={selectClass}
          >
            <option value={480}>480p</option>
            <option value={720}>720p</option>
            <option value={1080}>1080p</option>
            <option value={2160}>2160p / 4K</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel>
            {t("settings.qualityProfiles.cutoffResolution")}
          </FieldLabel>
          <select
            value={form.cutoff_resolution ?? ""}
            onChange={(e) =>
              set(
                "cutoff_resolution",
                e.target.value ? Number(e.target.value) : null,
              )
            }
            className={selectClass}
          >
            <option value="">{t("settings.qualityProfiles.noCutoff")}</option>
            <option value={480}>480p</option>
            <option value={720}>720p</option>
            <option value={1080}>1080p</option>
            <option value={2160}>2160p / 4K</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <MultiSelect
          label={t("settings.qualityProfiles.preferredSources")}
          placeholder="Sélectionner des sources…"
          options={SOURCE_OPTIONS}
          selected={form.preferred_sources}
          onChange={(v) => set("preferred_sources", v)}
        />
        <MultiSelect
          label={t("settings.qualityProfiles.preferredCodecs")}
          placeholder="Sélectionner des codecs…"
          options={CODEC_OPTIONS}
          selected={form.preferred_codecs}
          onChange={(v) => set("preferred_codecs", v)}
        />
      </div>

      <MultiSelect
        label={t("settings.qualityProfiles.preferredLanguages")}
        placeholder="Sélectionner des langues…"
        options={LANGUAGE_OPTIONS}
        selected={form.preferred_languages}
        onChange={(v) => set("preferred_languages", v)}
      />

      <TrackerPrioritySection
        trackers={form.prioritized_trackers}
        preferOverQuality={form.prefer_tracker_over_quality}
        onTrackersChange={(v) => set("prioritized_trackers", v)}
        onPreferOverQualityChange={(v) => set("prefer_tracker_over_quality", v)}
      />

      <div className="grid grid-cols-2 gap-4 items-start">
        <div className="flex flex-col gap-1.5">
          <FieldLabel>HDR</FieldLabel>
          <div className="space-y-2 pt-0.5">
            <label className="flex items-center gap-2.5 cursor-pointer select-none group">
              <span
                className={cn(
                  "flex h-4 w-4 items-center justify-center rounded border transition-colors",
                  form.prefer_hdr
                    ? "text-white border-primary-400 bg-primary-400"
                    : "border-neutral-600 group-hover:border-neutral-400",
                )}
              >
                {form.prefer_hdr && <Check size={10} strokeWidth={3} />}
              </span>
              <input
                type="checkbox"
                className="sr-only"
                checked={form.prefer_hdr}
                onChange={(e) => set("prefer_hdr", e.target.checked)}
              />
              <span className="text-sm text-neutral-300">
                {t("settings.qualityProfiles.preferHdr")}
              </span>
            </label>
            <label className="flex items-center gap-2.5 cursor-pointer select-none group">
              <span
                className={cn(
                  "flex h-4 w-4 items-center justify-center rounded border transition-colors",
                  form.require_hdr
                    ? "text-white border-primary-400 bg-primary-400"
                    : "border-neutral-600 group-hover:border-neutral-400",
                )}
              >
                {form.require_hdr && <Check size={10} strokeWidth={3} />}
              </span>
              <input
                type="checkbox"
                className="sr-only"
                checked={form.require_hdr}
                onChange={(e) => set("require_hdr", e.target.checked)}
              />
              <span className="text-sm text-neutral-300">
                {t("settings.qualityProfiles.requireHdr")}
              </span>
            </label>
          </div>
        </div>
        <FormInput
          label={t("settings.qualityProfiles.maxSizeGb")}
          type="number"
          step="0.1"
          min="0"
          value={form.max_size_gb ?? ""}
          onChange={(e) =>
            set(
              "max_size_gb",
              e.target.value ? parseFloat(e.target.value) : null,
            )
          }
          placeholder={t("settings.qualityProfiles.maxSizeGbPlaceholder")}
        />
      </div>

      <FormInput
        label={t("customFormats.minSeeders")}
        type="number"
        min="0"
        value={form.min_seeders}
        onChange={(e) => set("min_seeders", Number(e.target.value) || 0)}
        placeholder={t("customFormats.minSeedersHelp")}
      />

      <div className="flex flex-col gap-1.5">
        <FieldLabel>{t("customFormats.title")}</FieldLabel>
        <CustomFormatAssignmentEditor
          value={form.custom_formats}
          onChange={(v) => set("custom_formats", v)}
        />
      </div>

      <div className="flex items-center gap-2 pt-1 border-t border-neutral-700/60">
        <Button type="submit" disabled={busy}>
          {isEditing
            ? t("settings.qualityProfiles.save")
            : t("settings.qualityProfiles.create")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={onDismiss}
        >
          {t("settings.qualityProfiles.cancelEdit")}
        </Button>
      </div>
    </form>
  );
}
