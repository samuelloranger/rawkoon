import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Check, Images } from "lucide-react";
import type {
  ArtworkCandidate,
  ArtworkKind,
  LibraryMedia,
} from "@rawkoon/shared/types";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
import { useArtworkCandidates } from "@/features/medias/hooks/useArtworkCandidates";
import { useUpdateLibraryArtwork } from "@/features/medias/hooks/useUpdateLibraryArtwork";
import { languageDisplayName } from "@/lib/utils/languageDisplayName";
import { ManagementSection } from "./LibrarySharedUI";

/** Filter values that are not a language code. */
const ALL = "all";
const NEUTRAL = "none";

interface Props {
  libraryId: number;
  item: LibraryMedia;
}

export function LibraryImagePickerSection({ libraryId, item }: Props) {
  const { t, i18n } = useTranslation("common");
  const [kind, setKind] = useState<ArtworkKind>("poster");
  const [filter, setFilter] = useState<string>(ALL);
  const [hovered, setHovered] = useState<ArtworkCandidate | null>(null);
  const updateArtwork = useUpdateLibraryArtwork();

  const { data, isLoading } = useArtworkCandidates(libraryId, kind, true);
  const candidates = useMemo(() => data?.candidates ?? [], [data]);

  const currentUrl = kind === "poster" ? item.poster_url : item.backdrop_url;

  const languages = useMemo(() => {
    const codes = new Set<string>();
    let neutral = false;
    for (const c of candidates) {
      if (c.language) codes.add(c.language);
      else neutral = true;
    }
    const sorted = [...codes].sort((a, b) =>
      languageDisplayName(a, i18n.language).localeCompare(
        languageDisplayName(b, i18n.language),
        i18n.language,
      ),
    );
    return { sorted, neutral };
  }, [candidates, i18n.language]);

  const visible = useMemo(() => {
    if (filter === ALL) return candidates;
    if (filter === NEUTRAL) return candidates.filter((c) => !c.language);
    return candidates.filter((c) => c.language === filter);
  }, [candidates, filter]);

  const selected = useMemo(
    () => candidates.find((c) => c.url === currentUrl) ?? null,
    [candidates, currentUrl],
  );

  // Details describe one image at a time: whichever is under the pointer, else
  // the one in use. Eight permanent badges would compete with the artwork.
  const detailed = hovered ?? selected;

  const save = (url: string | null) => {
    void updateArtwork
      .mutateAsync({ id: libraryId, kind, url })
      .then(() => {
        toast.success(
          t("library.management.artworkUpdated", "Artwork updated"),
        );
      })
      .catch(() => {
        toast.error(
          t(
            "library.management.artworkUpdateFailed",
            "Couldn't change the artwork",
          ),
        );
      });
  };

  const isPoster = kind === "poster";

  return (
    <ManagementSection
      icon={Images}
      title={t("library.management.artwork", "Artwork")}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SegmentedTabs
            variant="chips"
            ariaLabel={t("library.management.artwork", "Artwork")}
            value={kind}
            onChange={(next) => {
              setKind(next);
              setFilter(ALL);
              setHovered(null);
            }}
            containerClassName="w-auto"
            // Apricot is reserved for the artwork in use, so the mode tab stays
            // neutral — otherwise the eye lands on the word, not the image.
            activeItemClassName="border-neutral-600 bg-neutral-700/50 text-neutral-100"
            items={[
              {
                id: "poster" as ArtworkKind,
                label: t("library.management.artworkPoster", "Poster"),
              },
              {
                id: "backdrop" as ArtworkKind,
                label: t("library.management.artworkBackdrop", "Backdrop"),
              },
            ]}
          />

          {languages.sorted.length > 1 || languages.neutral ? (
            <select
              data-testid="artwork-lang-select"
              aria-label={t("library.management.artworkLanguage", "Language")}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="focus-ring rounded-full border border-neutral-700 bg-neutral-800/80 px-3 py-1.5 text-sm text-neutral-300"
            >
              <option value={ALL}>
                {t("library.management.artworkAllLanguages", "All languages")}
              </option>
              {languages.sorted.map((code) => (
                <option key={code} value={code}>
                  {languageDisplayName(code, i18n.language)}
                </option>
              ))}
              {languages.neutral ? (
                <option value={NEUTRAL}>
                  {t("library.management.artworkNoLanguage", "No text")}
                </option>
              ) : null}
            </select>
          ) : null}
        </div>

        {isLoading ? (
          <p className="text-xs text-neutral-500">
            {t("library.management.artworkLoading", "Loading artwork…")}
          </p>
        ) : visible.length === 0 ? (
          <p data-testid="artwork-empty" className="text-xs text-neutral-500">
            {candidates.length === 0
              ? t(
                  "library.management.artworkEmpty",
                  "No artwork available for this title",
                )
              : t(
                  "library.management.artworkNoneInLanguage",
                  "No artwork in that language",
                )}
          </p>
        ) : (
          <div
            data-testid="artwork-grid"
            onMouseLeave={() => setHovered(null)}
            className="grid gap-2 rounded-xl border border-border bg-surface-inset p-2"
            style={{
              gridTemplateColumns: `repeat(auto-fill, minmax(${
                isPoster ? "104px" : "168px"
              }, 1fr))`,
            }}
          >
            {visible.map((c) => (
              <ArtworkTile
                key={c.url}
                candidate={c}
                kind={kind}
                current={c.url === currentUrl}
                disabled={updateArtwork.isPending}
                onPick={() => save(c.url)}
                onFocus={() => setHovered(c)}
              />
            ))}
          </div>
        )}

        <div className="flex min-h-6 items-center justify-between gap-3">
          <p className="truncate px-0.5 text-xs text-neutral-500">
            {detailed ? <CandidateDetail candidate={detailed} /> : null}
          </p>
          {currentUrl ? (
            <button
              type="button"
              data-testid="artwork-reset"
              disabled={updateArtwork.isPending}
              onClick={() => save(null)}
              className="focus-ring -mr-1.5 shrink-0 rounded-md px-1.5 py-1 text-xs text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-60"
            >
              {t("library.management.artworkReset", "Use default")}
            </button>
          ) : null}
        </div>
      </div>
    </ManagementSection>
  );
}

/** Source, language and pixel size of one candidate, weighted by importance. */
function CandidateDetail({ candidate }: { candidate: ArtworkCandidate }) {
  const { t, i18n } = useTranslation("common");
  const size =
    candidate.width && candidate.height
      ? `${candidate.width}×${candidate.height}`
      : null;
  const language = candidate.language
    ? languageDisplayName(candidate.language, i18n.language)
    : t("library.management.artworkNoLanguage", "No text");

  return (
    <>
      <span className="text-neutral-300">
        {candidate.source === "fanart" ? "fanart.tv" : "TMDB"}
      </span>
      <span className="ml-2">{language}</span>
      {size ? <span className="ml-2 tabular-nums">{size}</span> : null}
    </>
  );
}

function ArtworkTile({
  candidate,
  kind,
  current,
  disabled,
  onPick,
  onFocus,
}: {
  candidate: ArtworkCandidate;
  kind: ArtworkKind;
  current: boolean;
  disabled: boolean;
  onPick: () => void;
  onFocus: () => void;
}) {
  return (
    <button
      type="button"
      data-url={candidate.url}
      data-current={current ? "true" : "false"}
      aria-pressed={current}
      disabled={disabled}
      onClick={onPick}
      onMouseEnter={onFocus}
      onFocus={onFocus}
      className={`focus-ring group relative overflow-hidden rounded-lg bg-neutral-800 transition disabled:opacity-60 ${
        current
          ? "ring-2 ring-primary-400"
          : "ring-1 ring-border hover:ring-neutral-500"
      }`}
      style={{ aspectRatio: kind === "poster" ? "2 / 3" : "16 / 9" }}
    >
      <img
        src={candidate.thumb_url}
        alt=""
        loading="lazy"
        className="h-full w-full object-cover"
      />
      {current ? (
        <span className="absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-full bg-primary-400 text-neutral-950 shadow-[0_1px_4px_rgba(0,0,0,0.5)]">
          <Check size={12} strokeWidth={3} />
        </span>
      ) : null}
    </button>
  );
}
