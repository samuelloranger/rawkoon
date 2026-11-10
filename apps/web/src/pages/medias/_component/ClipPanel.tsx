import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  useClipSettings,
  useMediaClips,
  useRecutClip,
} from "@/features/clips/hooks";
import { formatMmSs, parseMmSs } from "@/features/clips/format";
import { useLibraryItem } from "@/features/medias/hooks/useLibraryItem";
import { ApiError } from "@/lib/api/client";
import { CLIPS_ENDPOINTS } from "@/lib/endpoints";
import { useCurrentUser } from "@/lib/auth/useAuth";

/** Preview clip of a movie (season omitted) or of one season; admins only, and only while clips are on. */
export function ClipPanel({
  libraryId,
  season,
}: {
  libraryId: number;
  season?: number;
}) {
  const { t } = useTranslation("common");
  const isAdmin = useCurrentUser().data?.is_admin === true;
  const enabled = useClipSettings(isAdmin).data?.enabled === true;
  const active = isAdmin && enabled;
  const clip = useMediaClips(libraryId, active).data?.find(
    (c) => (season ?? 0) === c.season_number,
  );
  const item = useLibraryItem(libraryId).data?.item;
  const recut = useRecutClip();
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);

  if (!active || !clip || !item) return null;

  const parsed = parseMmSs(value);
  const invalid = touched && parsed === null;
  const busy =
    clip.status === "queued" || clip.status === "running" || recut.isPending;

  const submit = () => {
    setTouched(true);
    if (parsed === null) return;
    recut.mutate(
      { id: clip.id, start_sec: parsed },
      {
        onError: (e) =>
          toast.error(
            e instanceof ApiError ? e.message : t("clips.panel.recutFailed"),
          ),
      },
    );
  };

  return (
    <section className="space-y-2 rounded-xl border border-neutral-800 bg-neutral-900/60 p-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-neutral-100">
          {t("clips.panel.title")}
        </h3>
        <span className="text-xs text-neutral-400">
          {t(`clips.panel.status.${clip.status}`)}
        </span>
      </div>
      {clip.status === "done" && (
        <video
          // New src after a re-cut makes the element reload.
          key={clip.updated_at}
          src={CLIPS_ENDPOINTS.FILE(
            item.tmdb_id,
            item.type === "show" ? "show" : "movie",
            season,
            clip.updated_at,
          )}
          muted
          loop
          controls
          playsInline
          preload="metadata"
          className="aspect-video w-full max-w-md rounded-lg bg-black"
        />
      )}
      {clip.status === "failed" && clip.error && (
        <p className="break-all text-xs text-red-400">{clip.error}</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-neutral-400" htmlFor={`clip-${clip.id}`}>
          {t("clips.panel.startLabel")}
        </label>
        <input
          id={`clip-${clip.id}`}
          value={value}
          placeholder={
            clip.start_sec != null ? formatMmSs(clip.start_sec) : "mm:ss"
          }
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => setTouched(true)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          aria-invalid={invalid}
          className="w-20 rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1 text-sm text-neutral-50"
        />
        <button
          type="button"
          disabled={busy}
          onClick={submit}
          className="rounded-lg border border-neutral-700 px-3 py-1.5 text-[13px] font-semibold text-neutral-200 hover:bg-neutral-900 disabled:opacity-50"
        >
          {t("clips.panel.recut")}
        </button>
        {invalid && (
          <span className="text-xs text-red-400">
            {t("clips.panel.invalid")}
          </span>
        )}
      </div>
    </section>
  );
}
