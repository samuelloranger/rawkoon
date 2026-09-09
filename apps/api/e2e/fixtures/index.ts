import { adminFixtures } from "./admin";
import { authFixtures } from "./auth";
import { authorsFixtures } from "./authors";
import { bookQualityProfilesFixtures } from "./book-quality-profiles";
import { customFormatsFixtures } from "./custom-formats";
import { dashboardFixtures } from "./dashboard";
import { downloadClientFixtures } from "./download-client";
import { integrationsFixtures } from "./integrations";
import { labbyFixtures } from "./labby";
import { notificationsFixtures } from "./notifications";
import { qualityProfilesFixtures } from "./quality-profiles";
import { releasesFixtures } from "./releases";
import { requestsFixtures } from "./requests";
import { searchFixtures } from "./search";
import { settingsFixtures } from "./settings";
import { systemFixtures } from "./system";
import { usersFixtures } from "./users";
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
  ...downloadClientFixtures,
  ...authFixtures,
  ...adminFixtures,
  ...integrationsFixtures,
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
