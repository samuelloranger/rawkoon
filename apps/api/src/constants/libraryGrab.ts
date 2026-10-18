/** Failed cron grab attempts before a book is auto-skipped and admins are notified.
 *  At the 6-hourly release sweep this is 4 attempts/day — 24 ≈ 6 days. Manual
 *  searches do not count against this cap and reset the counter on invocation. */
export const MAX_CRON_GRAB_ATTEMPTS = 24;

/** Movie and episode misses searched on every release sweep (≈ 3 days at the 6-hourly default). */
export const LIBRARY_FAST_GRAB_ATTEMPTS = 12;

/** Past the fast misses, a movie or episode is searched again once this long after its last miss. */
export const LIBRARY_SLOW_GRAB_INTERVAL_MS = 20 * 60 * 60 * 1000;

/** Movie and episode misses before auto-skip: 12 fast, then one a day ≈ 30 days at the default sweep.
 *  Late-arriving releases (dubs, regional WEB-DLs) often land well after the first week. */
export const MAX_LIBRARY_GRAB_ATTEMPTS = 40;

/** Cron grab attempts at or above this threshold surface on the library attention list. */
export const LIBRARY_ATTENTION_WARN_ATTEMPTS = 12;

/** Pending `download_history` rows older than this many hours are flagged as possibly stuck. */
export const LIBRARY_ATTENTION_STUCK_PENDING_HOURS = 36;

/** Failed or post-process issues older than this are omitted from the attention list. */
export const LIBRARY_ATTENTION_ISSUE_LOOKBACK_DAYS = 14;

/** Max rows returned from `GET /api/library/attention` after merge/dedupe. */
export const LIBRARY_ATTENTION_MAX_ITEMS = 25;

export const LIBRARY_ATTENTION_PER_SOURCE_DH_TAKE = 60;
export const LIBRARY_ATTENTION_PER_SOURCE_EPISODE_TAKE = 80;
export const LIBRARY_ATTENTION_PER_SOURCE_MOVIE_TAKE = 60;

/** Max .torrent file size when fetched server-side (bytes) */
export const MAX_TORRENT_FILE_BYTES = 15 * 1024 * 1024;

/** qBittorrent category for library movie grabs (save path configured in qB) */
export const QBIT_CATEGORY_RAWKOON_MOVIES = "rawkoon-movies";

/** qBittorrent category for library TV grabs */
export const QBIT_CATEGORY_RAWKOON_SHOWS = "rawkoon-shows";

/** qBittorrent category for ebook grabs */
export const QBIT_CATEGORY_RAWKOON_BOOKS = "rawkoon-books";

/** qBittorrent category for audiobook grabs */
export const QBIT_CATEGORY_RAWKOON_AUDIOBOOKS = "rawkoon-audiobooks";

/** Search reason when nothing in the indexer results fit; the one miss that is not an error. */
export const NO_MATCH_REASON = "No matching releases found";
