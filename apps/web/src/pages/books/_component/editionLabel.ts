import type { BookFormat } from "@rawkoon/shared/types";

/**
 * Label for an edition chip.
 *
 * The status is ALWAYS shown. An earlier version rendered `format ?? status`,
 * which meant that as soon as a file existed the chip read "epub" and the word
 * "downloaded" never appeared anywhere on the list — a fully imported book
 * looked like it had not been downloaded. The format is useful, so it is
 * appended rather than substituted.
 *
 * Takes the already-translated status: the caller has the `t` function, and
 * passing the raw server value in would put an untranslatable string on screen.
 * The format is a file extension and stays as-is in every language.
 */
export function editionChipLabel(
  statusLabel: string,
  format: BookFormat | string | null,
): string {
  return format ? `${statusLabel} · ${format}` : statusLabel;
}
