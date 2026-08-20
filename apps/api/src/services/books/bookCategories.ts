import {
  QBIT_CATEGORY_RAWKOON_AUDIOBOOKS,
  QBIT_CATEGORY_RAWKOON_BOOKS,
} from "@rawkoon/api/constants/libraryGrab";
import type { BookEditionKind } from "@rawkoon/shared/types";

/**
 * Download-client category for an edition kind.
 *
 * Its own module so the grab path and the adoption path can both use it without
 * importing each other — bookGrabber calls bookAdopt on a duplicate, so the
 * reverse import would be a cycle.
 */
export const qbCategoryForEditionKind = (kind: BookEditionKind): string =>
  kind === "audiobook"
    ? QBIT_CATEGORY_RAWKOON_AUDIOBOOKS
    : QBIT_CATEGORY_RAWKOON_BOOKS;
