# Listening stats — design

**Date:** 2026-09-06
**Status:** approved in chat, ready for implementation planning after spec review
**Board task:** #1086

## Problem

Rawkoon records where a listener left off (`book_listening_progress`: one
position per user per audiobook edition) but not how much they listened. There
is no hours-this-week, no streak, and no series completion view. Continue
listening answers “where was I,” not “how am I doing.”

## Scope

**In**

- Credit listening **content-seconds** from the existing audiobook progress PUT
  (no new player protocol).
- Persist per-user per-day totals from ship day onward (no backfill).
- `GET /api/books/listening-stats` for both clients.
- Home card (web dashboard widget + iOS home stack) showing streak, hours this
  week, and at most one series line.
- Stats screen (web `/stats`, iOS push from the card) with the same three
  figures, a 7-bar ISO week, and the series list.
- EN + FR copy.

**Out, with reasons**

- **Reading stats.** An EPUB locator is not minutes. Later.
- **Configurable daily goals / rings.** v1 is retrospective numbers.
- **WidgetKit / Live Activities.** In-app card only.
- **Per-edition or per-device hour logs.** One bucket per user per calendar day.
- **Wall-clock hours.** Credit is content-seconds (1.5× still counts audio
  covered, not minutes on the clock).
- **Backfill.** Hours start when this ships. Series percent uses existing
  progress and does not wait on recording.
- **Player / progress-schema changes.** PUT body stays as it is.
- **Nav item.** `/stats` is reachable from the card (and by URL). No sidebar
  entry unless books nav later wants one.
- **Releases.** No version bump or GitHub release by an agent.

## Calendar and timezone

All day boundaries use `loadConfig().TZ` (already in env, default
`America/New_York`; production is `America/Toronto`). Tests pin `TZ`.

- **Today** = calendar date of `now` in that zone.
- **ISO week** = Monday 00:00 through Sunday 23:59:59.999 of the week that
  contains today, in that zone.
- **Day stored on a credit** = calendar date of the PUT’s server `receivedAt`
  in that zone.

## Recording

On `PUT /api/books/editions/:id/progress`, after the last-write-wins check:

The LWW read that already loads `updatedAt` must also load `positionSecs` and
`receivedAt` — those are the previous values for credit.

1. If the PUT is not applied (existing `updatedAt` is newer), credit **0**.
2. If this upsert **creates** the progress row, credit **0**.
3. Otherwise let `delta = newPosition - previousPosition` and
   `elapsedWallSecs = (thisReceivedAt - previousReceivedAt) / 1000`.
4. If `elapsedWallSecs < 0`, credit **0** (clock skew).
5. Credit `delta` only when
   `0 < delta ≤ elapsedWallSecs * 2.0 + 15`.
   Max rate 2.0 matches the player; 15s covers PUT jitter.
6. Clamp the credited amount so a single PUT cannot add more than
   `elapsedWallSecs * 2.0 + 15` (already implied by 5).

Consequences that are in scope, not bugs:

- Offline car listen: one PUT after reconnect with ~45 min of position over
  ~45 min of wall clock **counts**.
- Scrub forward while PUTs are still every ~10s **does not** count.
- Pause 45 min then scrub 45 min in one PUT **can** false-positive. Accepted
  for v1.
- Two devices listening at once add into the same daily row.

Credit runs in the same request as the upsert. Increment the daily row
atomically (`INSERT … ON CONFLICT (user_id, day) DO UPDATE SET seconds =
book_listening_daily.seconds + EXCLUDED.seconds`). If that increment throws,
**log and still return the progress response** (`applied: true` when the
upsert applied). Playback must not fail because stats failed.

Extract the credit decision as a pure function (previous position, new
position, elapsed wall seconds → credited seconds) and unit-test it. The route
only supplies the inputs.

## Data model

```
model BookListeningDaily {
  userId  String   @map("user_id")
  day     DateTime @db.Date
  seconds Float
  user    User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([userId, day])
  @@map("book_listening_daily")
}
```

`seconds` is a float because progress positions are floats. No `edition_id`.
No retention job: one row per user per day is bounded.

Prisma `User` gains `listeningDaily BookListeningDaily[]`.

## API

`GET /api/books/listening-stats` on the books router, `requireUser`.

The API does **not** extra-gate on `books_enabled` (progress GET/PUT already
do not). The UI hides the feature when books are off (below).

Response (snake_case, shared type `BookListeningStats`):

```ts
{
  timezone: string;       // config TZ, so clients do not guess
  today_secs: number;
  week_secs: number;      // sum of the seven ISO-week days
  streak_days: number;
  since: string | null;   // YYYY-MM-DD of the earliest bucket, else null
  week: { day: string; seconds: number }[]; // length 7, Mon..Sun, zeros ok
  series: BookListeningSeriesStat[];
}

type BookListeningSeriesStat = {
  name: string;
  books_total: number;
  books_finished: number;
  percent: number;          // integer 0–100
  current_title: string | null;
};
```

Empty listening history is **200 with zeros**, not 404. `since` is null iff
the user has no daily rows.

### Streak

Let `last` be today if today’s bucket has `seconds > 0`, else yesterday if
yesterday’s does, else none.

- None → `streak_days = 0`.
- Otherwise count consecutive calendar days backward from `last` with
  `seconds > 0`.

A Friday morning open after a Thursday listen still shows the Thursday streak.

### Series

Include a `series_name` only when **at least two** library books with that
name have an **audiobook** edition. Ebook-only books are ignored.

For each included book:

- ratio = `1` if listening progress `finished` is true;
- else if progress exists and `total_duration_secs > 0`,
  `clamp(position_secs / total_duration_secs, 0, 1)`;
- else `0`.

`percent` = round(mean(ratios) * 100). `books_finished` = count with
`finished`. `current_title` = title of the in-progress audiobook in the group
(`!finished`, `position_secs > 1`) with the latest progress `updatedAt`, else
null.

Order: series with a `current_title` first (that progress `updatedAt` desc),
then remaining alphabetically by `name`.

## Home card

Web: new widget in `WidgetGrid`, beside Continue listening, same
`CardErrorBoundary`. Hidden when `books_enabled` is false (Continue listening
hides when there are no items; this card still shows at 0h so the hint is
visible).

iOS: card in `HomeView`’s widget stack. Hidden when books are disabled.
Pull-to-refresh reloads stats with the rest of the dashboard.

Shows:

1. `streak_days` (e.g. `12` + “day streak”).
2. `week_secs` as hours/minutes using each platform’s existing duration helper
   (`3h 20m`, under one hour `20m`, zero `0h`).
3. At most one series line: the first series in the API order that has a
   `current_title`, else omitted. Copy: `{name} · {percent}%`.

If `since` is null, still show `0h` / `0` streak plus one hint line that hours
start from this update. Series line may still appear (library-derived).

Tap → stats screen. Load failure uses the same widget error treatment as
Continue listening.

## Stats screen

Web route: `/stats` (`apps/web/src/pages/stats/index.tsx`). No sidebar item.
If `books_enabled` is false, redirect to `/`. Typed URL should not expose a
books feature while the library is off.

iOS: `NavigationLink` from the card to a pushed `ListeningStatsView`. Same
payload, no extra endpoint.

Layout:

- Same three figures as the card (no hint line once you are on the page).
- Seven bars, Mon–Sun, empty days are zero-height, future days of this week
  included as zeros.
- Series list: `{name}`, `{books_finished} of {books_total}`, `{percent}%`,
  and `current_title` when present.

No date-range control, no goal editor, no per-book hour table.

## Copy (English source)

| Key intent | English |
|---|---|
| Card / page title | Listening |
| Streak unit | i18n plural: “1 day streak” / “{{count}} day streak” |
| Hours start hint | Hours start now — listen and they’ll add up. |
| Empty series | No series in the library yet. |
| Stats week heading | This week |
| Stats series heading | Series |

French keys live next to the other books strings (`common.json` / String
Catalog). Do not leave EN-only UI.

## Files (expected)

| Area | Where |
|---|---|
| Migration + Prisma model | `apps/api/prisma/` |
| Credit + streak + week helpers | `apps/api/src/services/books/listeningStats.ts` (pure + DB) |
| Hook credit into PUT | `bookPlaybackRoutes.ts` progress PUT |
| GET | new `bookListeningStatsRoutes` used from `routes/books/index.ts` |
| Shared type | `apps/shared/src/types/books.ts` |
| Web widget | `apps/web/src/features/continue/` or `features/listening/` + `WidgetGrid` |
| Web page | `apps/web/src/pages/stats/` |
| iOS | `APIClient` method, DTO, home card, `ListeningStatsView` |

Players (`PlayerProvider`, `AudiobookPlayer`) are not modified.

## Tests

Pure, no DB:

- Credit: first PUT → 0; seek back → 0; 10s PUT with +12s position at 1× → 12;
  scrub +120s with 10s elapsed → 0; offline +2700s position with 2700s elapsed →
  2700; negative elapsed → 0.
- Streak: today; yesterday-only; gap; empty.
- ISO week: seven dates Mon–Sun in a pinned TZ including a week that spans
  months.
- Series grouping: drop one-book names; drop ebook-only; finished = ratio 1;
  mean → integer percent.

API (existing books progress test style):

- Applied PUT increments today’s row; LWW loser does not; credit throw still
  returns applied progress.
- GET shape: zeros + `since: null` for a user with no buckets; series present
  without any daily rows.

No new iOS UI test bundle required for v1; DTO decode is enough if an existing
Kit test file is the natural home. Web: widget/page render against a fixture.

## Success

After ship, a listen on iOS or web increases today’s seconds on the next
successful progress PUT. Home card and `/stats` agree. Series percent is
visible the same day for libraries that already have series, even at 0h.
Existing progress save behavior is unchanged when credit is skipped or fails.
