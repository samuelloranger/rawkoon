/** Failed cron grab attempts before an item is auto-skipped and admins are notified.
 *  At every-2h cadence this is 12 attempts/day — 24 ≈ 2 days. Manual searches
 *  do not count against this cap and reset the counter on invocation. */
export const MAX_CRON_GRAB_ATTEMPTS = 24;

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
