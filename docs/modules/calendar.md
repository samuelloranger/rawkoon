# Calendar

Read-only month view of upcoming movie / TV / episode releases from the media library.

Last verified: 2026-06-08

## Locations

| Layer | Path                                                         |
| ----- | ------------------------------------------------------------ |
| Web   | `apps/web/src/pages/calendar/`                               |
| Data  | Dashboard "upcoming" releases (`GET /api/dashboard/upcoming`) |

## Data Source

The calendar has no dedicated API of its own. It reuses the dashboard
upcoming-releases query (`useDashboardUpcoming` → `GET /api/dashboard/upcoming`)
and buckets the returned `DashboardUpcomingItem`s by `release_date` for the
displayed month. Clicking a release opens the media detail dialog (or navigates
to the library item if it already exists).

The release region/window is configured via `AppSettings.countryCode` (TMDB
region), `upcomingWindowMonths`, and `upcomingLanguages`. There are no
user-created events, holidays, or iCal feed — those features were removed.

## Web

`apps/web/src/pages/calendar/_component/` holds the page (`Calendar.tsx`), the
month grid (`CalendarGrid.tsx`), and the selected-day panel
(`CalendarDayPanel.tsx`). All are presentational over the upcoming-releases data.
