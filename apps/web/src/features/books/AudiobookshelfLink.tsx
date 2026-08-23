import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";
import { audiobookshelfSearchUrl } from "@rawkoon/shared/utils";
import type { BookEdition } from "@rawkoon/shared/types";
import { useMediaPostProcessingSettings } from "@/features/medias/hooks/useMediaPostProcessingSettings";

/**
 * Hand-off to Audiobookshelf, which owns playback and reading.
 *
 * Rawkoon stores no Audiobookshelf item ids, so the deepest link available is a
 * search inside the library that matches the edition's kind. Nothing renders
 * when Audiobookshelf is unconfigured or the edition has no imported files —
 * an install without Audiobookshelf sees no change.
 */
export const AudiobookshelfLink = ({
  edition,
  title,
}: {
  edition: BookEdition;
  title: string;
}) => {
  const { t } = useTranslation("common");
  const { data } = useMediaPostProcessingSettings();
  const settings = data?.settings;

  const imported = edition.file_count > 0 || edition.status === "downloaded";
  const libraryId =
    edition.kind === "audiobook"
      ? settings?.audiobookshelf_audiobook_library_id
      : settings?.audiobookshelf_ebook_library_id;
  const href = imported
    ? audiobookshelfSearchUrl(settings?.audiobookshelf_url, libraryId, title)
    : null;

  if (!href) return null;

  // A styled anchor, not <Button asChild>: Button never implemented asChild,
  // so the prop reached the DOM, the anchor kept none of the button styling,
  // and its icon and label stacked on top of each other.
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="focus-ring inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-lg bg-neutral-800 px-4 text-sm font-medium text-neutral-100 transition-colors hover:bg-neutral-700"
    >
      <ExternalLink className="h-4 w-4" />
      {t("books.audiobookshelf.open")}
    </a>
  );
};
