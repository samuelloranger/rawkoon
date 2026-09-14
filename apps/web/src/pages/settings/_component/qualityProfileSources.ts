/**
 * Release sources a quality profile can rank.
 *
 * The value is the parser's spelling (`filenameParser.parseReleaseSource`) and
 * is what gets stored and scored — only the label is display text. "Blu-ray" is
 * the trademarked name; "BluRay" is how release titles spell it.
 */
export const SOURCE_OPTIONS = [
  { value: "REMUX", label: "REMUX" },
  { value: "BluRay", label: "Blu-ray" },
  { value: "WEB-DL", label: "WEB-DL" },
  { value: "WEBRip", label: "WEBRip" },
  { value: "HDTV", label: "HDTV" },
];

/** Display name for a stored source value; unknown values pass through. */
export function sourceLabel(value: string): string {
  return SOURCE_OPTIONS.find((o) => o.value === value)?.label ?? value;
}
