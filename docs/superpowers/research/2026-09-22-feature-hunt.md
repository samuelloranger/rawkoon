# Feature hunt: what to build next

Date: 2026-09-22 · Rawkoon v1.31.3 · Follows an earlier Radarr/Sonarr/Overseerr parity gap analysis

## Method

Three research passes, run in parallel:

1. **Companion tools**: what self-hosters bolt onto the *arr stack (GitHub READMEs, star counts via the API), and newer all-in-one competitors.
2. **Demand**: the top open issues by 👍 and by comment count in Radarr, Sonarr, Prowlarr, sct/overseerr and seerr-team/seerr; the Seerr discussions board; about 30 Reddit threads (via Arctic Shift).
3. **Books ecosystem**: Readarr's successors, Audiobookshelf's top requests, and reader-sync standards.

Every "missing" claim below was checked with a grep of `apps/`. Rows marked *(verify)* rest on that grep only, not on reading or running the code.

Counts: `r` = 👍 reactions, `c` = comments, `pts` = Reddit score, `★` = GitHub stars (2026-09-22).

## Context that changed since the parity analysis

- **Overseerr is archived**; it merged with Jellyseerr into **Seerr**. **Readarr is archived** (2025-06), and no successor has clearly won.
- **Huntarr is gone.** An unauthenticated API leaked every connected app's keys (r/selfhosted, 8,603 pts, the largest arr thread of 2026). That is a strong argument for one process that holds all the credentials.
- **Competitors now ship subtitles, fake-torrent detection and OIDC by default:** MediaManager 3.3k★, Cinephage 830★ (Nov 2025), Nefarious 1.3k★, Mydia 788★.
- **Adoption gates** from the MediaManager threads: "no Usenet is a non-starter" (top comment, 140 pts), and TRaSH/custom-format compatibility. Distrust of AI-built projects is high after Huntarr and the BookLore drama, so stability is itself a selling point.

## Ranked shortlist

### Tier 1: small, well evidenced, builds on what exists

| # | Feature | Evidence | Why it fits | Size |
|---|---|---|---|---|
| 1 | **Queue janitor.** Auto-blocklist a release when it fails or stalls. Strike counter and minimum-speed rule. Block payloads with dangerous extensions (`.exe`, `.lnk`, `.scr` inside a "movie"). Handle failed imports. | Cleanuparr 2.6k★, decluttarr 881★. Sonarr #958 (50r/63c), Radarr #5407 (29r/69c), Prowlarr #2329 (41r). Fake pre-release torrents are a top complaint on the MediaManager thread (926 pts). | **Verified gap.** `failDownload` (`services/downloadOutcome.ts`) marks the row failed and reverts the title to wanted, but never writes `GrabBlocklist`. Only the season-pack step and the manual route do. The next search can re-grab the same dead release. | S–M |
| 2 | **Seeding lifecycle.** Remove the torrent from the client once it is imported and a ratio or seed-time target is met. Remove it when the title is deleted or upgraded. Scan for orphan torrents. | qui 4.5k★, qbit_manage 1.6k★. Radarr #3918 (59r). "Had to set up qbit-manage because upgrades leave old torrents." | Imports hardlink, so dropping the client copy is safe. No remove-torrent code exists in `services/downloadClient`. | S–M |
| 3 | **Reader ecosystem bundle: OPDS feed + KOReader sync + send-to-Kindle.** | ABS #1953 (OPDS, 72r). kosync ships in CWA, Komga, Grimmory and BookOrbit. Every ebook server has send-to-Kindle. | All three are missing (grep `opds`/`kosync`: none). KOReader sync maps onto `BookReadingProgress`. OPDS lets KOReader, Moon+ and Yomu browse the library. Send-to-Kindle needs mail (SMTP) settings plus one button. | S each |
| 4 | **Streaming-availability rule.** Skip, warn or auto-deny when a title is on one of the household's subscriptions. | Overseerr #835 (40r/60c), Radarr #3333 (24r/58c), Seerr #165 (35r). Excludarr. | TMDB watch-provider data is already fetched. Only the rule is missing. | S |
| 5 | **Per-user "notify me"** on a title, or on new episodes of a show already in the library. Several users can follow the same item. | Overseerr #789 (92r), Seerr #480 (48r), #375 (37r). | Notification channels and web push already exist. This needs a follow table and one event. | S–M |

### Tier 2: foundations that unlock several features

| # | Feature | Evidence | Unlocks | Size |
|---|---|---|---|---|
| 6 | **Jellyfin watch-history ingestion** (played, last-played, per user) | Tautulli 6.6k★, Tracearr 2.65k★, Jellystat 2.5k★. Seerr #2449 (49r). | Items #7, #8 and #11 below, plus watch stats. Only library refresh exists today; nothing reads play data. | M |
| 7 | **"Leaving soon" cleanup rules.** Inputs: last watched, watched by the requester, age, size. The grace period shrinks as the disk fills. Surfaced as a Jellyfin "Leaving soon" collection, with keep requests and a dry run. | Maintainerr 2.3k★, Janitorr 754★, Jellysweep, Deleterr. Sonarr #314 (38r/102c, most-commented open Sonarr issue). Seerr #308 (93r). | Requesters, files and the disk gauge are already in one DB, so the Maintainerr↔Seerr re-download loop can't happen. Pairs with a recycle bin (a known parity gap). | L |
| 8 | **Watch-driven TV.** Grab the next season near a finale. Stay N episodes ahead. Remove watched episodes after a grace period. | Pulsarr 747★, Prefetcharr, Episeerr. | Needs #6. | M |
| 9 | **Subtitles.** Per-language profiles, OpenSubtitles, a missing-subtitle scan. Optional local-LLM translation. | Bazarr 4.3k★ (top companion tool), Lingarr 879★. Built into Cinephage and Nefarious. MediaManager's top open issue. | Subtitle tracks are already stored from mediainfo. Strong fit for a French-speaking audience. Whisper generation would be CPU-only on typical homelab hardware. | M–L |
| 10 | **Series entity for books.** Series page, missing-in-series detection, series monitoring, autoplay the next audiobook in the series. | ABS #963/#711/#1604/#4007. ABS app #416 (up-next, 116r). "Complete my series" (101 pts). | Partial today: `seriesName`/`seriesPosition` sit on the book, with no entity or monitoring. Extends author monitoring. | M |

### Tier 3: big bets (highest demand, highest cost)

| # | Feature | Evidence | Notes | Size |
|---|---|---|---|---|
| 11 | **Several versions per title** (4K + 1080p, per language, editions) | Sonarr #4551 (116r), Radarr #1910 (72r/54c), Radarr #145 (33r/81c). "Almost everyone's biggest gripe" (MediaManager thread). Users run 4 Radarr instances for this. | Schema-level change: a profile per version. The multi-instance workaround is the pain an all-in-one should remove. | L |
| 12 | **Ebook ↔ audiobook position sync** | ABS #189 (93r), #3084 (63r), #1723 (57r). Storyteller thread (482 pts). BookBridge 496★. | Rawkoon already pairs editions and stores both progress types. Start coarse (chapter or percentage). Sentence-level via Storyteller EPUB 3 read-along later. Few competitors do this; it would set Rawkoon apart. | M coarse / L fine |
| 13 | **Kobo sync** (emulate the Kobo store API) | ABS #3504 (265r, most-reacted ABS issue). | Heavy: a subset of the store API, kepubify conversion, proxying to the real Kobo store. | L |

## Known parity gaps: demand ranking

The demand pass counted signal for the parity gaps already catalogued. Strongest first:

1. **Anime.** Sonarr #6495 (176r, top open Sonarr issue), Overseerr #2876 (34r/47c), Seerr #232 (26r).
2. **Partial-season, single-episode and future-only requests.** Overseerr #342 (90r), Seerr #264 (72r), Overseerr #3750 (45r).
3. **Permissions, quotas, auto-approve, request routing, parental controls.** Overseerr #835, #1881 (34r), #3533 (age limits, 42r/45c). Seerr #501 (40r).
4. **Multiple root folders.** Radarr #153 (35r/292c, most-commented open Radarr issue).
5. **Usenet.** Barely asked for on GitHub (the *arrs already have it), but decisive on Reddit as an adoption gate.
6. **Import lists (Trakt, TMDB lists).** Seerr discussion #239 (44 upvotes), Pulsarr 747★.

Weak signal: recycle bin, manual import, rename preview, NFO, issue reporting, backup, iCal.

## Cheap wins (S, low evidence but near-free)

- Strip audio and subtitle tracks at import (keep fr/en/original). Muxarr, striptracks. The remux worker already exists.
- Archive (RAR) extraction on import. Sonarr #784 (20r/75c), Unpackerr 1.5k★.
- Custom-format conditions on indexer, protocol or bitrate. Radarr #6697 (22r).
- Paste a release title and see its score breakdown. This would also explain the LLM picker's choices.
- Notification templates. Overseerr #405 (53r), Sonarr #328 (20r).
- Per-book playback speed, delete finished downloads automatically, audiobook bookmarks (iOS).
- Per-user book rating, review and finished date. Goodreads/StoryGraph CSV import into the wanted list.
- iCal feed (none today).

## Deliberately not recommended

- **Music** (Seerr #96, 132r) and **sports** (Sportarr, Racecarr): separate domains, and Lidarr owns music.
- **Podcasts, comics and manga**: Audiobookshelf, Kavita and Komga own these.
- **Plex/Emby support** (Overseerr #295, 236r): large demand, but the product is Jellyfin-first.
- **Debrid, .strm and IPTV**: don't fit a torrent-only acquisition model.
- **Base URL / subpath hosting and branding** (Overseerr #274, 120r; #404, 106r): real demand, low value for a single-household deploy.
- **ABS-compatible API layer**: large, moving target. Revisit only if Android clients become a goal.

## Suggested sequence

1. **"Janitor" release**: #1 + #2 + archive extraction + track stripping. All small, all acquisition hygiene, and #1 fixes a verified re-grab loop.
2. **"Readers" release**: #3 (OPDS + KOReader + send-to-Kindle) + #10 (series).
3. **"Watched" release**: #6 (Jellyfin watch history), then #7 (Leaving soon) and #8.
4. Pick one big bet: #11 (versions) or #12 (ebook↔audiobook sync). Subtitles (#9) can slot in anywhere.

## Sources (primary)

- Companions: github.com/Cleanuparr/Cleanuparr · ManiMatter/decluttarr · autobrr/qui · StuffAnThings/qbit_manage · Maintainerr/Maintainerr · Schaka/janitorr · morpheus65535/bazarr · lingarr-translate/lingarr · Tautulli/Tautulli · connorgallopo/Tracearr · CyferShepard/Jellystat · jamcalli/Pulsarr · haijeploeg/excludarr · Unpackerr/unpackerr · KirovAir/muxarr · Dictionarry-Hub/profilarr · recyclarr/recyclarr · Ravencentric/awesome-arr
- Competitors: github.com/maxdorninger/MediaManager · MoldyTaint/Cinephage · lardbit/nefarious · getmydia/mydia
- Demand: github.com/Sonarr/Sonarr/issues/{4551,314,255,6495,958} · Radarr/Radarr/issues/{1910,153,3918,3333,1447} · sct/overseerr/issues/{789,835,342,295} · seerr-team/seerr/issues/{308,501,96,264}
- Books: wiki.servarr.com/readarr · github.com/advplyr/audiobookshelf/issues/{3504,1953,189,963} · advplyr/audiobookshelf-app/issues/{416,236} · komga.org/docs/guides/koreader · storyteller-platform.dev · docs.hardcover.app · github.com/Chaptarr/chaptarr · pennydreadful/bookshelf · calibrain/shelfmark
- Huntarr: store.elfhosted.com/blog/2026/02/24/huntarr-ends-its-hunt-newtarr-takes-it-up/
