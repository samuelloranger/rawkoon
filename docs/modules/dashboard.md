# Dashboard (Home)

The homepage is a **fixed media composition** — a greeting followed by a stable, ordered set of sections. There is no configurable widget grid, no edit mode, no smart tiles, no per-admin widget visibility, and no AppSettings dashboard-layout/quick-links state.

Last verified: 2026-06-14

## Locations

| Layer | Path                                                                          |
| ----- | ----------------------------------------------------------------------------- |
| Web   | `apps/web/src/pages/index.tsx` → `apps/web/src/pages/_component/HomePage.tsx` |
| API   | `apps/api/src/routes/dashboard/`                                              |

## Composition

`HomePage` renders a greeting (`GreetingCard`) then five sections, each wrapped in a `CardErrorBoundary` and a staggered fade-in motion variant, in this fixed order:

1. **Recently added** — `RecentlyAddedRail`: poster rail of the latest items in the built-in library (`added_at` desc).
2. **Upcoming releases** — `UpcomingRail`: poster rail backed by the dashboard upcoming-releases feed.
3. **Now watching** — `NowWatchingRail`: live view of who is currently streaming from Jellyfin (active `/Sessions`), showing the viewer, the title, playback progress, and a paused indicator. Backed by `useNowWatching`, which polls `/api/dashboard/jellyfin/now-playing` every ~15s. **Conditional**: renders `null` (hidden entirely) when Jellyfin is not configured — the API reports `enabled: false`; when Jellyfin is enabled but nobody is streaming it shows a quiet placeholder.
4. **Operational row** — `OperationalRow`: two-column grid of `DownloadsPanel` (torrent activity) + `LibraryAttentionPanel` (alerts / items needing attention).
5. **Secondary row** — `SecondaryRow`: two-column grid of `TrackersPanel` + `RssStatusPanel`.

The poster rails all wrap a shared `PosterRail` primitive. Panels reuse the kept widget primitives (`WidgetShell` / `WidgetHeader` / kicker) for consistent chrome — these are layout primitives, not the removed widget engine.

## API Surface

`apps/api/src/routes/dashboard/index.ts` composes per-section sub-plugins under prefix `/api/dashboard`:

- `activities`, `upcoming`, `jellyfin`, `trackers`, `downloads`, `favicon`.

Each is a thin orchestrator that reads from `Integration` config + cached service responses. Most return on a 30s–5min cache; SSE is used only for `downloads` (torrent speed needs sub-second refresh). `favicon` proxies third-party favicons (with caching) so links don't expose internal URLs to the browser.

## Upcoming Media

The `REFRESH_UPCOMING` cron (every 12h at :30) pre-renders the upcoming-releases snapshot keyed by `AppSettings.countryCode` + `upcomingWindowMonths` + `upcomingLanguages`. The rail reads the cached snapshot rather than hitting TMDB on every page load. Worker: `apps/api/src/workers/refreshUpcoming.ts`.

## Activity Feed

Backed by `ActivityLog`. Filterable by `service` and `type`. Each library grab, integration test, cron run, etc. writes one row via `logActivity()` (`apps/api/src/utils/activityLogs.ts`). The `activities` route remains the data source for activity-driven cache invalidation even though the home no longer renders a standalone activity widget.

## Web Query Keys

All dashboard data uses `queryKeys.dashboard.*` from `apps/web/src/lib/queryKeys.ts`. Mutations elsewhere (e.g. grabbing media) should invalidate the dashboard slice they affect.
