# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Users

Primary: the homelab administrator who installs and runs the instance — quality profiles, grabs, users, and the download pipeline.

Confirmed second audience: household members who request titles, browse the library, and listen to audiobooks. They do not administer the instance.

## Product Purpose

Rawkoon is a self-hosted library for movies, TV, ebooks, and audiobooks. It discovers titles, searches releases, hands downloads to a client, and imports files — one application instead of a stack of *arr tools.

Success is a household that can find, request, and receive media from one instance, and listen to audiobooks on an iPhone without a browser.

## Positioning

One image replaces Radarr, Sonarr, and Overseerr, and books live in that same image rather than a second project. The iPhone app is the front-end for the whole instance: it manages the movie/TV pipeline and plays audiobooks itself (chapters download offline; Now Playing is the screen a PWA could not keep alive). Video playback stays in Jellyfin or Plex.

## Operating Context

- The instance runs at home (Docker: API + web in one container, Postgres, Redis). There is no public SaaS.
- Administrators work in the browser for setup and library management; the iPhone is for on-the-go manage and listen.
- Discovery: TMDB (movies/TV), Google Books (books). Releases: Prowlarr or Jackett. Downloads: qBittorrent, Transmission, or Deluge.
- First account on a new instance is the administrator. There is no open registration; later accounts are created by an admin.
- Books are a first-class domain behind an admin flag (`booksEnabled`).
- Early-stage: breaking changes between releases are expected.

## Capabilities and Constraints

In-product:

- Movies and TV: discover, request, quality profiles, grab, monitor, import, calendar of upcoming *releases*.
- Books: ebook and audiobook editions, same request/grab/quality-profile surface as video.
- iOS: Discover / Library / Activity / Settings; audiobook playback with chapter downloads, position sync, lock-screen Now Playing. The phone does not play video.

Out, and to be removed:

- Chores and habits.
- Household/custom calendar events. Calendar is only upcoming movie and TV show releases.

Terminology that future work must keep: library, request, grab, quality profile, edition, chapter, monitor, Now Playing.

GPL-3.0. Published as `ghcr.io/samuelloranger/rawkoon`. Live docs: https://samlo.cloud/rawkoon

## Brand Commitments

- Name: Rawkoon.
- Logo: `apps/web/public/icon.svg`.
- Web and iPhone are one product. Native structure on iOS (TabView, NavigationStack, sheets, system controls); the same product in the browser. Do not fork a second identity.

## Evidence on Hand

- Product screenshots: `docs/screenshots/`.
- Public docs site (VitePress): `docs/`, published at samlo.cloud/rawkoon.
- No customer testimonials, case studies, or fabricated usage numbers. Do not invent them.

## Product Principles

1. Collapse the stack, don't recreate it — one instance, one image, books included.
2. The phone is the remote for video and the player for audiobooks.
3. Design for the admin's job first; household members request and listen, they do not configure.
4. Stay a media library. Home-hub features (chores, habits, personal events) are out.
5. One product on two surfaces: native iOS structure, shared Rawkoon identity.
