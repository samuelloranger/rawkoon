// Bounded by non-alphanumerics, so "1920x1080" and "2000kbps" are not years.
const YEAR_TOKEN = /(?<![\dA-Za-z])(?:19|20)\d{2}(?![\dA-Za-z])/g;

/**
 * A movie release fits when any year it names, other than years in the title
 * itself ("Blade Runner 2049"), is within one of the movie's; a release naming
 * no other year fits. Any year, not just the last, so remaster years pass.
 */
export function releaseYearFits(
  releaseTitle: string,
  movieYear: number | null,
  movieTitles: string[],
): boolean {
  if (movieYear == null) return true;
  const titleYears = new Set(
    movieTitles.flatMap((t) => t.match(YEAR_TOKEN) ?? []),
  );
  const years = (releaseTitle.match(YEAR_TOKEN) ?? [])
    .filter((y) => !titleYears.has(y))
    .map(Number);
  return years.length === 0 || years.some((y) => Math.abs(y - movieYear) <= 1);
}
