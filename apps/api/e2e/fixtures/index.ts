import { adminFixtures } from "./admin";
import { authFixtures } from "./auth";
import { authorsFixtures } from "./authors";
import { bookQualityProfilesFixtures } from "./book-quality-profiles";
import { booksFixtures } from "./books";
import { customFormatsFixtures } from "./custom-formats";
import { dashboardFixtures } from "./dashboard";
import { downloadClientFixtures } from "./download-client";
import { downloadsFixtures } from "./downloads";
import { integrationsFixtures } from "./integrations";
import { labbyFixtures } from "./labby";
import { mcpFixtures } from "./mcp";
import { libraryFixtures } from "./library";
import { libraryExtraFixtures } from "./library-extra";
import { mediasFixtures } from "./medias";
import { notificationsFixtures } from "./notifications";
import { qualityProfilesFixtures } from "./quality-profiles";
import { releasesFixtures } from "./releases";
import { requestsFixtures } from "./requests";
import { searchFixtures } from "./search";
import { settingsFixtures } from "./settings";
import { systemFixtures } from "./system";
import { usersFixtures } from "./users";
import { calendarFixtures } from "./calendar";
import { clipsFixtures } from "./clips";
import { exportFixtures } from "./export";
import { jellyfinFixtures } from "./jellyfin";
import { shelvesFixtures } from "./shelves";
import { transcodeFixtures } from "./transcode";
import { tvFixtures } from "./tv";
import { type FixtureRegistry, type Route, routeKey } from "./types";

// Per-domain registries are spread in here as they land (Tasks 10-28).
export const registry: FixtureRegistry = {
  ...systemFixtures,
  ...dashboardFixtures,
  ...customFormatsFixtures,
  ...qualityProfilesFixtures,
  ...settingsFixtures,
  ...searchFixtures,
  ...notificationsFixtures,
  ...requestsFixtures,
  ...usersFixtures,
  ...releasesFixtures,
  ...authorsFixtures,
  ...bookQualityProfilesFixtures,
  ...labbyFixtures,
  ...mcpFixtures,
  ...downloadClientFixtures,
  ...downloadsFixtures,
  ...authFixtures,
  ...adminFixtures,
  ...integrationsFixtures,
  ...mediasFixtures,
  ...booksFixtures,
  ...libraryFixtures,
  ...libraryExtraFixtures,
  ...calendarFixtures,
  ...clipsFixtures,
  ...exportFixtures,
  ...jellyfinFixtures,
  ...shelvesFixtures,
  ...transcodeFixtures,
  ...tvFixtures,
};

// Coverage gate: every manifest route must have a fixture, and every fixture key
// must match a real route. This is what keeps "each and every endpoint" honest.
export function coverageReport(
  routes: Route[],
  fixtures: FixtureRegistry,
): { uncovered: Route[]; extra: string[] } {
  const routeKeys = new Set(routes.map(routeKey));
  const fixtureKeys = new Set(Object.keys(fixtures));
  const uncovered = routes.filter((r) => !fixtureKeys.has(routeKey(r)));
  const extra = [...fixtureKeys].filter((k) => !routeKeys.has(k));
  return { uncovered, extra };
}
