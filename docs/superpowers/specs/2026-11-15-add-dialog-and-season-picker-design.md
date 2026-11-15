# Add dialog and season picker

## Why

Adding a title is one tap with no choices. An admin gets the default quality profile and every season of a show, then has to fix both on the detail page. A requester can only ask for a whole show, even when they want one season or only what airs next.

The most-upvoted Seerr/Overseerr requests are season-level requests (single season, future seasons only), and Rawkoon already has the building blocks: per-season monitoring endpoints and a search-on-add that only searches monitored episodes.

## Goals

- An admin adding a movie, show or book picks the quality profile (and, for shows, which seasons) before the title is added.
- A requester picks which seasons of a show they want. The admin sees that choice at approval.
- A show remembers whether newly aired seasons should be monitored.
- Every interactive add surface on web and iOS goes through the same dialog.
- The dialog can be turned off in settings; it is on by default.

## Non-goals

- Requesting more seasons of a show already in the library (admin uses "Manage seasons"; parked as a follow-up because it needs more than one request per show).
- Single-episode requests.
- Per-user preferences for the dialog.
- Specials (season 0) in the picker.

## Anti-goals

- Breaking older clients. Every new API field is optional and its absence means today's behaviour (default profile, all seasons, monitor new seasons).
- Changing non-interactive adds (folder scan import, assign from disk, Radarr/Sonarr migration, author-release worker) beyond the Sonarr fix below.

## Rules (decided)

### Season modes

| Mode | Episodes monitored at add | `monitorNewSeasons` |
|---|---|---|
| `all` | every regular episode | as chosen (default on) |
| `future` | episodes with `airDate` in the future or unknown; nothing already aired | forced on |
| `latest` | every episode of the most recent season with at least one aired episode, plus all future episodes | as chosen |
| `pick` | episodes of the listed `seasons` only | as chosen |

- An announced season with no aired episode never counts as "latest".
- Specials are excluded everywhere, as the episode sync already drops them.

### Monitor new seasons

- New field `LibraryMedia.monitorNewSeasons Boolean @default(true)`.
- When the daily episode sync inserts episodes of a season the show did not have before, they are created `monitored = monitorNewSeasons`.
- New episodes of a season that already exists inherit the season's state: monitored if any existing episode of that season is monitored.

### Who sees what

| Actor | Movie | Show | Book |
|---|---|---|---|
| Admin, "Ask before adding" on | dialog when ≥2 movie profiles, else instant add | dialog (profile + seasons + search now) | dialog (format + book profile) |
| Admin, setting off | instant add with defaults | instant add with defaults | instant add with defaults |
| Non-admin, "Let requesters choose seasons" on | one-tap request | season picker, no profile | one-tap request |
| Non-admin, setting off | one-tap request | one-tap request (all seasons) | one-tap request |

- Admins never see "Request"; they only see "Add". An admin book request is replaced by a direct add.
- The discover-card quick "+" becomes "Request" for non-admins (it currently 403s).

### Settings (Settings → Media, server-wide, on by default)

- `askBeforeAdding` (bool, default true)
- `requestersChooseSeasons` (bool, default true)
- `defaultSeasonMode` (`all` | `future` | `latest`, default `all`)
- `defaultMonitorNewSeasons` (bool, default true)

The defaults prefill the dialog and apply whenever the dialog is skipped. Default profiles already exist (`defaultMovieQualityProfileId`, `defaultShowQualityProfileId`, `defaultBookQualityProfileId`).

## API

- `POST /api/library`: adds optional `quality_profile_id`, `season_mode`, `seasons`, `monitor_new_seasons`. `addOrUpdateLibraryFromTmdb` already accepts `qualityProfileId`; the episode upsert gains a monitoring plan.
- `POST /api/requests`: adds optional `season_mode`, `seasons` (shows only). Stored on `MediaRequest` as `seasonMode String?` and `seasons Int[]`.
- `POST /api/requests/:id/approve`: adds optional `season_mode`, `seasons`, `monitor_new_seasons`; absent means "use what the requester chose".
- Admin auto-approved requests apply the request's season choice.
- `PATCH /api/library/:id/monitored-seasons` (new): `{ season_mode, seasons?, monitor_new_seasons }` for "Manage seasons"; reuses `setSeasonMonitored`.
- `POST /api/books` and `POST /api/books/discovery/add`: accept `kinds` and `book_quality_profile_id`; discovery stops hard-coding `["ebook"]`.
- TMDB title details: `TmdbSeasonSummary` gains `air_date` (first air date of the season) so the picker can show years and resolve "latest".
- Media settings GET/PUT expose the four new settings.
- Sonarr migration copies each series' season `monitored` flags instead of leaving every episode monitored.

## Clients

### Web

- One `AddTitleDialog` (Radix Dialog on desktop, bottom sheet under `sm`) used by `useAddTitle`/`useAddToLibrary` callers: explore detail dialog, explore card "+", Find results, swipe deck, home hero, and every surface that opens the explore detail dialog (calendar, upcoming rail, collections, watchlist).
- A compact variant for the swipe deck and hero: profile and season mode prefilled, one confirm.
- Book add (`AddBookDialog`, `DiscoveryBookSheet`, Find book rows) uses the same dialog with format chips.
- Request flow for shows opens the season section alone.
- Requests page approve row shows the requested seasons next to the profile select, editable.
- Show detail "Manage seasons" opens the season section with the current state.
- Settings → Media gains the four settings.

### iOS

- One `AddTitleSheet` (detents medium/large) driven from `AppModel.addPick`, `submitAdd`, `submitRequest`, book search and book discovery.
- `ProfilePickerSheet` on approval gains the season section.
- Show detail "Manage seasons" presents the season section.
- Settings parity is web-only for admin media settings unless the iOS admin settings already expose Media settings.

## Shipping

Three stacked PRs merged through one integration branch: (1) API + settings + migration, (2) web, (3) iOS. iOS is installed on a device for testing before its PR is opened.

## Tests

- API: season-mode → monitored plan (all/future/latest/pick, announced-season edge), sync inserting a new season with `monitorNewSeasons` on/off, request create/approve carrying seasons, old-client bodies unchanged, settings off → defaults.
- Web: dialog renders per type, skipped when the setting is off, movie skip with one profile, request season picker for non-admins.
- iOS: compile + app tests on macbuild; device test of add, request and manage seasons.
