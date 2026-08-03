# Bug report — automatic search uses the English title, never finds foreign-language releases

**Date:** 2026-08-01
**Reporter:** Samuel Loranger
**Env:** prod (`ghcr.io/samuelloranger/rawkoon`, `APP_VERSION=v1.4.5`), host `homelab`
**Example title:** *Bellefleur* (TMDB `251088`, library id `2442`, stored as **"Belflower"**)

## Summary

Cron/automatic search builds its indexer query from `library_media.title`, which is
always persisted in English (`TMDB_LANGUAGE_LIBRARY_PERSISTENCE = "en-US"`). For a
show whose releases only exist under the original/foreign title, the query returns
zero results, forever. Every episode of *Bellefleur* had to be grabbed by hand via
the interactive search's language picker.

The interactive search **does** offer per-language titles (`SearchTitleSelect` /
`buildTitleOptions`); the automatic path has no equivalent.

## Evidence

### 1. Library row is English, releases are French

```
$ psql -c "select id,title,type,tmdb_id,status from library_media where id=2442;"
2442|Belflower|show|251088|returning
```

All 13 grabs recorded for this show carry the French title:

```
$ psql -c "select release_title,indexer,grabbed_at from download_history where media_id=2442 order by grabbed_at;"
Bellefleur.S01.VFQ.1080p.WEB.AC3.5.1.H264-FW                    C411   2026-07-07 01:25:59
Bellefleur.2024.S02.FRENCH.1080p.WEB.DD5.1.H265-SiC             Torr9  2026-07-07 01:27:19
Bellefleur.S03E01.AD.VFQ.1080p.WEB.AC3.5.1.H264-TFA             C411   2026-07-07 01:32:47
Bellefleur.S03E02.AD.VFQ.1080p.WEB.AC3.5.1.H264-TFA             C411   2026-07-07 01:32:48
Bellefleur.S03E03.AD.VFQ.1080p.WEB.AC3.5.1.H264-MTLQC           C411   2026-07-15 12:48:22
Bellefleur.S03E04.VFQ.1080p.WEB.H264.DD.5.1-WebVision           Torr9  2026-07-22 00:44:29
Bellefleur.S03E05.AD.VFQ.1080p.WEB.AC3.5.1.H264-MTLQC           C411   2026-07-22 00:44:56
Bellefleur.S03E06.AD.VFQ.1080p.WEB.AC3.5.1.H264-MTLQC           C411   2026-07-22 00:45:00
Bellefleur.S03E06..E10 (5 more)                                 C411   2026-08-01 22:59
```

`episode_id` is NULL on 10 of 13 rows — the signature of a manual interactive grab,
not a cron grab.

### 2. Cron burned its full retry budget on the affected episodes

```
$ psql -c "select id,season,episode,status,search_attempts from library_episodes where media_id=2442 and season=3;"
1027661|3|3 |downloaded|24
1189111|3|4 |downloaded| 0     <- grabbed manually before cron caught up
1189110|3|5 |downloaded|23
1189112|3|6 |downloaded|23
1360333|3|7 |downloaded|24
1360334|3|8 |downloaded|24
1360335|3|9 |downloaded|11
1360336|3|10|wanted    |11
```

Seasons 1–2 (grabbed manually on import day) show `search_attempts = 0`. Every
episode the cron actually had to find shows 11–24 failed attempts.

### 3. Direct A/B against the prod indexer (Jackett, all indexers, cat 5000)

```
Query = "Belflower S03E10"    -> 0 results
Query = "Bellefleur S03E10"   -> 3 results
    Bellefleur.S03E10.FRENCH.1080p.WEB.AC3.5.1.H264-MTLQC
    Bellefleur.S03E10.FiNAL.AD.VFQ.1080p.WEB.AC3.5.1.H264-MTLQC
    Bellefleur.S03E01.AD.VFQ.1080p.WEB.AC3.5.1.H264-TFA
```

Same indexer set, same category, same moment. The only variable is the title.

## Root cause

Two independent single-title assumptions, both on the automatic path:

1. **Query construction** — `apps/api/src/workers/checkEpisodeReleases.ts:141`
   ```ts
   searchQuery: episodeSearchQuery(ep.media.title, ep.season, ep.episode)
   ```
   `episodeSearchQuery` (`:11`) and `seasonPackSearchQuery` (`:21`) take only
   `media.title`. `media.title` is persisted in English by design
   (`apps/api/src/utils/medias/tmdbFetcherTypes.ts:63`). No fallback to
   `original_title` or to TMDB translations.

2. **Result filter** — `apps/api/src/services/mediaGrabberSearch.ts:101-104`
   ```ts
   const expectedTitle = media?.title ? normalizeTitleForMatch(media.title) : null;
   ...
   if (!normalizedRelease.startsWith(`${expectedTitle} `)) continue;
   ```
   Even if the query were fixed, every `Bellefleur.*` release would still be
   discarded because it doesn't start with `belflower`. Both layers must accept a
   set of acceptable titles, not one.

Note the same `media.title` also feeds `pollIndexerRss.ts` (RSS matching), so RSS
grabs miss this show too.

## Scope

Affects any title whose library (English) name differs from the name releases are
published under — foreign-language originals in general, not just fr-CA. On this
instance that is at minimum *Belflower/Bellefleur*; a broader sweep of
`library_media` where the TMDB `original_title` differs from `title` would size it.

## Suggested direction (not implemented)

- Persist `original_title` + `original_language` on `library_media` (and optionally
  a user-chosen `search_title`), populated at add time from the TMDB details the
  interactive picker already fetches.
- Have `checkEpisodeReleases` / `pollIndexerRss` search over a **list** of candidate
  titles (library title, original title, explicit override) and union the results.
- Make `expectedTitle` in `searchAndGrab` a set membership test over that same list.
- Reset `search_attempts` / un-`skip` episodes once a media's search titles change.

## Side observation (unrelated, worth fixing)

`docker inspect rawkoon` shows plaintext secrets in the container env
(`SMTP_PASS`, `DATABASE_URL` password, `REDIS_URL` password), and the `ygg` and
`g3mini` rows in `integrations.config` store **unencrypted** passwords while every
other tracker row uses `enc:`. Those two rows should be re-saved through the
encrypting path.
