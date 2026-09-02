import { Locator, LocatorLocations } from "@readium/shared";

/** One locator per spine item. EpubNavigator requires a positions list. */
export function spinePositions(
  items: { href: string; type?: string | null; title?: string | null }[],
): Locator[] {
  const n = items.length;
  return items.map(
    (item, i) =>
      new Locator({
        href: item.href,
        type: item.type || "application/xhtml+xml",
        title: item.title ?? undefined,
        locations: new LocatorLocations({
          position: i + 1,
          progression: 0,
          totalProgression: n === 0 ? 0 : i / n,
        }),
      }),
  );
}
