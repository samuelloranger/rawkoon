import type { BookEditionStatus, BookFormat } from "@rawkoon/shared/types";

/** Statuses that are still in motion, so the UI should keep polling. */
const TRANSIENT: BookEditionStatus[] = ["downloading", "upgrading"];

export const isTransientEditionStatus = (status: string): boolean =>
  (TRANSIENT as string[]).includes(status);

/**
 * Label for an edition chip.
 *
 * The status is ALWAYS shown. An earlier version rendered `format ?? status`,
 * which meant that as soon as a file existed the chip read "epub" and the word
 * "downloaded" never appeared anywhere on the list — a fully imported book
 * looked like it had not been downloaded. The format is useful, so it is
 * appended rather than substituted.
 */
export function editionChipLabel(
  status: string,
  format: BookFormat | string | null,
): string {
  return format ? `${status} · ${format}` : status;
}
