import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { BookFormat, BookQualityProfile } from "@rawkoon/shared/types";
import {
  bookFormatsForKind,
  type BookProfileKind,
} from "@rawkoon/shared/utils";
import {
  useCreateBookQualityProfile,
  useUpdateBookQualityProfile,
} from "@/pages/books/_hooks/useBooks";
import { ApiError } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { MultiSelect } from "./QualityProfileMultiSelect";
import { TrackerPrioritySection } from "./QualityProfileTrackerSection";
import { SEARCH_TITLE_LANGUAGE_OPTIONS } from "./QualityProfileForm";
import {
  bookProfileDraftToBody,
  bookProfileToDraft,
  emptyBookProfileDraft,
  moveFormat,
  pruneDraftForKind,
  toggleFormat,
  validateBookProfileDraft,
  type BookProfileDraftState,
} from "./bookQualityProfileDraft";

const LABEL = "block text-sm font-medium text-neutral-300 mb-1.5";
const HINT = "mt-1.5 text-xs text-neutral-500";
/** Radix Select has no empty value, so "no cutoff" needs a sentinel. */
const NO_CUTOFF = "none";

const KINDS: BookProfileKind[] = ["ebook", "audiobook", "both"];

/**
 * Ordered format picker. Order is the preference order the scorer uses, so it
 * is edited explicitly rather than inferred from a checkbox list.
 */
function FormatPreference({
  kind,
  selected,
  onToggle,
  onMove,
}: {
  kind: BookProfileKind;
  selected: BookFormat[];
  onToggle: (format: BookFormat) => void;
  onMove: (from: number, to: number) => void;
}) {
  const { t } = useTranslation("common");
  const available = bookFormatsForKind(kind).filter(
    (f) => !selected.includes(f),
  );

  return (
    <div>
      <span className={LABEL}>
        {t("settings.bookQualityProfiles.allowedFormats")}
      </span>
      {selected.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-700 px-3 py-2.5 text-xs text-neutral-500">
          {t("settings.bookQualityProfiles.noFormats")}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {selected.map((format, index) => (
            <li
              key={format}
              className="flex items-center gap-2 rounded-lg border border-neutral-700/60 bg-neutral-900/40 px-3 py-2"
            >
              <span className="w-5 shrink-0 text-xs font-semibold tabular-nums text-neutral-500">
                {index + 1}
              </span>
              <span className="flex-1 text-sm font-medium text-neutral-200">
                {format}
              </span>
              <button
                type="button"
                onClick={() => onMove(index, index - 1)}
                disabled={index === 0}
                className="rounded-md p-1 text-neutral-400 transition-colors hover:bg-neutral-700 hover:text-neutral-200 disabled:opacity-30"
                title={t("settings.bookQualityProfiles.moveUp")}
              >
                <ChevronUp size={14} />
              </button>
              <button
                type="button"
                onClick={() => onMove(index, index + 1)}
                disabled={index === selected.length - 1}
                className="rounded-md p-1 text-neutral-400 transition-colors hover:bg-neutral-700 hover:text-neutral-200 disabled:opacity-30"
                title={t("settings.bookQualityProfiles.moveDown")}
              >
                <ChevronDown size={14} />
              </button>
              <button
                type="button"
                onClick={() => onToggle(format)}
                className="rounded-md p-1 text-neutral-400 transition-colors hover:bg-red-500/10 hover:text-red-400"
                title={t("common.remove")}
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {available.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {available.map((format) => (
            <button
              key={format}
              type="button"
              onClick={() => onToggle(format)}
              className="rounded-md border border-neutral-700 px-2 py-1 text-xs font-medium text-neutral-300 transition-colors hover:border-primary-600 hover:text-primary-300"
            >
              + {format}
            </button>
          ))}
        </div>
      )}
      <p className={HINT}>{t("settings.bookQualityProfiles.formatsHint")}</p>
    </div>
  );
}

/**
 * Create or edit one book quality profile. The API validates the same rules;
 * this form's job is to make an invalid combination hard to build in the first
 * place — the cutoff only offers allowed formats, and switching kind prunes
 * formats that belong to the other one.
 */
export function BookQualityProfileForm({
  initialProfile,
  onDismiss,
}: {
  initialProfile?: BookQualityProfile;
  onDismiss: () => void;
}) {
  const { t } = useTranslation("common");
  const create = useCreateBookQualityProfile();
  const update = useUpdateBookQualityProfile();

  const [draft, setDraft] = useState<BookProfileDraftState>(() =>
    initialProfile
      ? bookProfileToDraft(initialProfile)
      : emptyBookProfileDraft(),
  );

  const patch = (over: Partial<BookProfileDraftState>) =>
    setDraft((prev) => ({ ...prev, ...over }));

  const saving = create.isPending || update.isPending;

  const submit = async () => {
    const error = validateBookProfileDraft(draft);
    if (error) {
      toast.error(
        error.code === "invalid"
          ? error.message
          : t(`settings.bookQualityProfiles.${error.code}`),
      );
      return;
    }

    const body = bookProfileDraftToBody(draft);
    try {
      if (initialProfile) {
        await update.mutateAsync({ id: initialProfile.id, ...body });
      } else {
        await create.mutateAsync(body);
      }
      toast.success(t("settings.bookQualityProfiles.saveSuccess"));
      onDismiss();
    } catch (e: unknown) {
      toast.error(
        e instanceof ApiError
          ? e.message
          : t("settings.bookQualityProfiles.saveError"),
      );
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label className={LABEL} htmlFor="book-profile-name">
          {t("settings.bookQualityProfiles.name")}
        </label>
        <Input
          id="book-profile-name"
          value={draft.name}
          onChange={(e) => patch({ name: e.target.value })}
          placeholder={t("settings.bookQualityProfiles.namePlaceholder")}
        />
      </div>

      <div>
        <span className={LABEL}>{t("settings.bookQualityProfiles.kind")}</span>
        <Select
          value={draft.kind}
          onValueChange={(value) =>
            setDraft((prev) =>
              pruneDraftForKind(prev, value as BookProfileKind),
            )
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {KINDS.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {t(`settings.bookQualityProfiles.kinds.${kind}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <FormatPreference
        kind={draft.kind}
        selected={draft.allowedFormats}
        onToggle={(format) => setDraft((prev) => toggleFormat(prev, format))}
        onMove={(from, to) => setDraft((prev) => moveFormat(prev, from, to))}
      />

      <div>
        <span className={LABEL}>
          {t("settings.bookQualityProfiles.cutoff")}
        </span>
        <Select
          value={draft.cutoffFormat ?? NO_CUTOFF}
          onValueChange={(value) =>
            patch({
              cutoffFormat: value === NO_CUTOFF ? null : (value as BookFormat),
            })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_CUTOFF}>
              {t("settings.bookQualityProfiles.noCutoff")}
            </SelectItem>
            {draft.allowedFormats.map((format) => (
              <SelectItem key={format} value={format}>
                {format}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className={HINT}>{t("settings.bookQualityProfiles.cutoffHint")}</p>
      </div>

      <div className="flex items-start justify-between gap-4 rounded-lg border border-neutral-700/60 px-3 py-2.5">
        <div>
          <p className="text-sm font-medium text-neutral-200">
            {t("settings.bookQualityProfiles.preferRetail")}
          </p>
          <p className="mt-0.5 text-xs text-neutral-500">
            {t("settings.bookQualityProfiles.preferRetailHint")}
          </p>
        </div>
        <Switch
          checked={draft.preferRetail}
          onCheckedChange={(checked) => patch({ preferRetail: checked })}
        />
      </div>

      <div
        className={cn(
          "grid gap-4",
          draft.kind === "ebook" ? "sm:grid-cols-2" : "sm:grid-cols-3",
        )}
      >
        <div>
          <label className={LABEL} htmlFor="book-profile-seeders">
            {t("settings.bookQualityProfiles.minSeeders")}
          </label>
          <Input
            id="book-profile-seeders"
            type="number"
            min={0}
            value={draft.minSeeders}
            onChange={(e) => patch({ minSeeders: e.target.value })}
          />
        </div>
        <div>
          <label className={LABEL} htmlFor="book-profile-size">
            {t("settings.bookQualityProfiles.maxSizeMb")}
          </label>
          <Input
            id="book-profile-size"
            type="number"
            min={0}
            value={draft.maxSizeMb}
            onChange={(e) => patch({ maxSizeMb: e.target.value })}
            placeholder={t("settings.bookQualityProfiles.noLimit")}
          />
        </div>
        {draft.kind !== "ebook" && (
          <div>
            <label className={LABEL} htmlFor="book-profile-bitrate">
              {t("settings.bookQualityProfiles.minAudioBitrate")}
            </label>
            <Input
              id="book-profile-bitrate"
              type="number"
              min={0}
              value={draft.minAudioBitrate}
              onChange={(e) => patch({ minAudioBitrate: e.target.value })}
              placeholder={t("settings.bookQualityProfiles.noLimit")}
            />
          </div>
        )}
      </div>

      <MultiSelect
        label={t("settings.bookQualityProfiles.preferredLanguages")}
        placeholder={t("settings.bookQualityProfiles.anyLanguage")}
        options={SEARCH_TITLE_LANGUAGE_OPTIONS}
        selected={draft.preferredLanguages}
        onChange={(next) => patch({ preferredLanguages: next })}
      />

      <TrackerPrioritySection
        trackers={draft.prioritizedTrackers}
        preferOverQuality={draft.preferTrackerOverQuality}
        onTrackersChange={(next) => patch({ prioritizedTrackers: next })}
        onPreferOverQualityChange={(next) =>
          patch({ preferTrackerOverQuality: next })
        }
      />

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onDismiss} disabled={saving}>
          {t("common.cancel")}
        </Button>
        <Button onClick={() => void submit()} disabled={saving}>
          {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}
