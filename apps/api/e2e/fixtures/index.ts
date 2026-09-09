import { dashboardFixtures } from "./dashboard";
import { systemFixtures } from "./system";
import { type FixtureRegistry, type Route, routeKey } from "./types";

// Per-domain registries are spread in here as they land (Tasks 10-28).
export const registry: FixtureRegistry = {
  ...systemFixtures,
  ...dashboardFixtures,
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
