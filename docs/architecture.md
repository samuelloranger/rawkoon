# Architecture

Rawkoon is one application with a React web interface, a Bun API, PostgreSQL
for durable state, and Redis-backed work queues. In production, the API and
web interface ship in the same container.

## System map

    Browser
      │
      ├── Rawkoon web application
      │     └── same-origin /api requests and server-sent events
      │
      └── Rawkoon API
            ├── PostgreSQL: users, library, settings, history, integrations
            ├── Redis/BullMQ: scheduled and background work
            ├── TMDB: discovery and catalog metadata
            ├── Prowlarr or Jackett: release search
            ├── qBittorrent, Transmission, or Deluge: active download client
            └── Jellyfin/Plex, OIDC, and Web Push: optional services

## Workspaces and boundaries

| Workspace | Responsibility |
| --- | --- |
| <code>apps/web</code> | React interface, routing, query cache, translations, and realtime UI |
| <code>apps/api</code> | Elysia routes, authentication, database access, integrations, workers, and file operations |
| <code>apps/shared</code> | Types, pure utilities, and constants used by both applications |

The shared workspace has no runtime dependency on the web or API applications.
The web app owns query hooks and query keys; the API owns business rules and
all secrets.

## A normal request

The browser makes root-relative <code>/api/...</code> calls with the session
cookie. Elysia authenticates the request where required, runs route-level
validation, then either performs simple database work directly or calls a
service for a larger workflow.

The API returns snake_case response fields. The web app’s shared HTTP client
handles cookies, errors, JSON, and same-origin URLs, so feature code does not
need to reproduce those rules.

## Production topology

The Docker build compiles the React app and copies it into the API image. At
startup, the API detects that built web files exist and serves the SPA from
the same origin as the API. It also injects the signed-in user into the HTML
shell, avoiding a separate first-session request.

Development stays split: Vite serves the web app while Bun runs the API. Vite
proxies browser API requests to the API process.

## Library data model

A <code>LibraryMedia</code> record represents a movie or show and keeps its
TMDB identity, catalog fields, status, monitoring state, and optional quality
profile. Shows own episodes. Media files and download-history records attach
to either a movie or a specific episode.

The important distinction is:

- **Catalog metadata** describes the title: name, year, overview, poster,
  release state, and episodes.
- **File metadata** describes an actual video file: path, size, codecs,
  resolution, HDR, audio and subtitle tracks, and language tags.

See [Media metadata](/library/metadata) for how those values are obtained and
corrected.

Books use their own tables rather than sharing <code>LibraryMedia</code>. A
<code>LibraryBook</code> keeps the Google Books identity and catalog fields; a
<code>BookEdition</code> is the ebook or audiobook of that title and owns the
monitoring state, quality profile, and files. Download history is shared with
media through a nullable edition reference, with a check constraint and a
second, disjoint partial unique index so a book grab and a media grab are
constrained independently. See [Books and audiobooks](/library/books).

In the browser, the SPA plays audiobooks with a single HTML audio element and
reads EPUBs with Readium. Positions go through the same progress endpoints the
iOS app uses. Playback is foreground-only: locking the phone or leaving the
tab typically pauses audio in Mobile Safari.

The iOS app also reads and plays books itself, so the server holds reading state
for both clients: <code>BookListeningProgress</code> for an audiobook (seconds on the
whole-book timeline) and <code>BookReadingProgress</code> for an ebook (spine
document plus an offset inside it). Both are keyed on <code>(user,
edition)</code>, both are last-write-wins with the client clock clamped to
server time. The web app surfaces them on Listen, Read, and the Home Continue
card.

## Download lifecycle

    Add title → choose profile → search releases → score or reject candidates
       → active download client → adaptive completion polling
       → hardlink/move into the library → MediaInfo scan → library update

Rawkoon records every grab before it sends it to the active client. Completion
is detected through adaptive polling. If
post-processing is enabled, Rawkoon resolves the completed video file, places
it according to your templates, scans it with MediaInfo, records the final
path, and requests a Jellyfin refresh when configured.

Failures remain in download history and can surface in the Library attention
list instead of silently disappearing.

## Background work

Redis and BullMQ keep slow work away from HTTP requests. Rawkoon has separate
queues for notifications/activity, scheduled tasks, library migration,
language reindexing, and remuxing.

Scheduled work refreshes upcoming releases, syncs show episodes, checks
download completion, polls indexer RSS feeds, runs weekly library integrity
checks, and refreshes attention alerts. When the book library is enabled, two
more jobs run: a book release sweep that also searches for format upgrades, and
a daily check for new titles from monitored authors. Library migration and file-heavy jobs
run one at a time to avoid competing writes.

## Realtime and health

Server-sent events keep download activity, notifications, and library updates
current without a polling-only UI. The Library health check looks for missing
file paths, stale catalog state, and workflow conditions that need an
operator’s attention.

The database is authoritative for configuration and history; media files,
VAPID keys, and <code>.env</code> remain part of the instance state and must
be included in backups. See [Deployment and recovery](/deployment).
