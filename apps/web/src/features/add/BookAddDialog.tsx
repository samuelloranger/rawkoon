import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { BookEditionKind } from "@rawkoon/shared/types";
import { cn } from "@/lib/utils";
import { useBookQualityProfiles } from "@/pages/books/_hooks/useBooks";
import { useMediaPostProcessingSettings } from "@/features/medias/hooks/useMediaPostProcessingSettings";
import {
  AddDialogShell,
  FieldLabel,
  GHOST_BTN,
  PRIMARY_BTN,
} from "./AddDialogShell";
import { ProfileSelect } from "./ProfileSelect";
import type { BookChoice, BookDisplay } from "./useAddFlow";

type Format = "ebook" | "audiobook" | "both";
const FORMATS: Format[] = ["ebook", "audiobook", "both"];
const kindsOf = (f: Format): BookEditionKind[] =>
  f === "both" ? ["ebook", "audiobook"] : [f];

/** A profile fits a format when it covers every kind chosen. */
function profilesForFormat<T extends { kind: Format }>(
  profiles: T[],
  format: Format,
): T[] {
  return profiles.filter((p) =>
    format === "both"
      ? p.kind === "both"
      : p.kind === format || p.kind === "both",
  );
}

/** Admin book add: pick the format first, then a quality profile that matches it. */
export function BookAddDialog({
  display,
  onSubmit,
  onClose,
}: {
  display: BookDisplay;
  onSubmit: (choice: BookChoice) => Promise<boolean>;
  onClose: (added?: boolean) => void;
}) {
  const { t } = useTranslation("common");
  const { data } = useBookQualityProfiles();
  const { data: settings } = useMediaPostProcessingSettings();
  const [pickedFormat, setFormat] = useState<Format | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const defaultId = settings?.settings.default_book_quality_profile_id ?? null;
  // Both only when the default profile covers both formats; otherwise an ebook.
  const format: Format =
    pickedFormat ??
    (data?.profiles.find((p) => p.id === defaultId)?.kind === "both"
      ? "both"
      : "ebook");
  const profiles = profilesForFormat(data?.profiles ?? [], format);
  // An explicit pick wins while it still fits the format; otherwise the default, then the first.
  const profileId =
    profiles.find((p) => p.id === picked)?.id ??
    profiles.find((p) => p.id === defaultId)?.id ??
    profiles[0]?.id ??
    null;

  const submit = async () => {
    setBusy(true);
    const ok = await onSubmit({ kinds: kindsOf(format), profileId });
    setBusy(false);
    if (ok) onClose(true);
  };

  return (
    <AddDialogShell
      title={display.title}
      subtitle={[display.author, display.year].filter(Boolean).join(" · ")}
      posterUrl={display.coverUrl}
      onClose={() => onClose()}
    >
      <div>
        <FieldLabel>{t("addDialog.format")}</FieldLabel>
        <div
          role="group"
          aria-label={t("addDialog.format")}
          className="flex flex-wrap gap-1.5"
        >
          {FORMATS.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={format === f}
              onClick={() => setFormat(f)}
              className={cn(
                "focus-ring rounded-full border px-[13px] py-1.5 text-sm transition-colors",
                format === f
                  ? "border-primary-400 bg-primary-400 font-semibold text-neutral-950"
                  : "border-border text-neutral-100 hover:border-border-strong",
              )}
            >
              {t(`addDialog.formats.${f}`)}
            </button>
          ))}
        </div>
      </div>
      <div>
        <FieldLabel>{t("addDialog.quality")}</FieldLabel>
        {!data ? null : profiles.length > 0 ? (
          <ProfileSelect
            profiles={profiles}
            value={profileId}
            onChange={setPicked}
            label={t("addDialog.quality")}
            className="h-auto rounded-xl bg-surface-inset py-2.5 font-semibold text-neutral-50"
          />
        ) : (
          <p className="text-sm text-neutral-400">
            {t("addDialog.noBookProfile")}
          </p>
        )}
      </div>
      <div className="flex justify-end gap-2.5 border-t border-border pt-4 max-sm:flex-col-reverse">
        <button type="button" className={GHOST_BTN} onClick={() => onClose()}>
          {t("addDialog.cancel")}
        </button>
        <button
          type="button"
          className={PRIMARY_BTN}
          disabled={busy}
          onClick={() => void submit()}
        >
          {busy ? t("addDialog.adding") : t("addDialog.add")}
        </button>
      </div>
    </AddDialogShell>
  );
}
