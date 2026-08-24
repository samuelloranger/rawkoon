import { prisma } from "@rawkoon/api/db";
import {
  readEbookMetadata,
  type EbookMetadata,
} from "@rawkoon/api/utils/books/ebookMetadata";
import type {
  BookMatchInput,
  BookMetadataProvider,
  ProviderFields,
} from "./types";

/**
 * On-disk metadata, ranked above every remote source.
 *
 * Rationale: the operator can fix a file with a tagger and rescan. If a remote
 * source outranked the file, that repair would be reverted on the next
 * refresh. Ranking local highest makes the file an override mechanism that
 * needs no UI.
 *
 * This promotes extraction rawkoon already does at import — audio container
 * tags for narrators, epub OPF for the rest — rather than adding a second,
 * divergent parser.
 *
 * Measured against a real Calibre-managed library: most epubs carry a
 * publisher, a minority carry calibre:series. Hence publisher is the field
 * this source contributes most often, and it never fabricates a series.
 */

export interface LocalMetadataInput {
  /** BookEdition.narrators, from container tags at import. */
  editionNarrators: string[];
  ebook: EbookMetadata | null;
}

export function mapLocalFields(input: LocalMetadataInput): ProviderFields {
  const fields: ProviderFields = {};
  if (input.editionNarrators.length > 0) {
    fields.narrators = input.editionNarrators;
  }
  const e = input.ebook;
  if (e) {
    if (e.publisher) fields.publisher = e.publisher;
    if (e.seriesName) fields.seriesName = e.seriesName;
    if (typeof e.seriesPosition === "number") {
      fields.seriesPosition = e.seriesPosition;
    }
  }
  // Deliberately not contributed: title and authors. A tagger's title is not
  // the indexer search term, and authors are owned by the book_authors trigger.
  return fields;
}

class LocalFileProvider implements BookMetadataProvider {
  readonly source = "local" as const;

  async enrich(book: BookMatchInput): Promise<ProviderFields> {
    const editions = await prisma.bookEdition.findMany({
      where: { bookId: book.bookId },
      select: {
        narrators: true,
        files: { select: { filePath: true, format: true } },
      },
    });

    const editionNarrators = [...new Set(editions.flatMap((e) => e.narrators))];
    const epub = editions
      .flatMap((e) => e.files)
      .find((f) => f.format === "epub");

    let ebook: EbookMetadata | null = null;
    if (epub) {
      // A missing or unreadable file is "nothing to say", never a failure:
      // this provider must not be able to break a refresh.
      ebook = await readEbookMetadata(epub.filePath).catch(() => null);
    }

    return mapLocalFields({ editionNarrators, ebook });
  }
}

export function getLocalFileProvider(): BookMetadataProvider {
  return new LocalFileProvider();
}
