import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";
import { audiobookshelfSearchUrl } from "@rawkoon/shared/utils";
import type { BookEdition } from "@rawkoon/shared/types";
import { Button } from "@/components/ui/button";
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

  return (
    <Button asChild variant="secondary">
      <a href={href} target="_blank" rel="noopener noreferrer">
        <ExternalLink className="size-4" />
        {t("books.audiobookshelf.open")}
      </a>
    </Button>
  );
};
