import { redis } from "@rawkoon/api/db/redis";

const REDIS_KEY_LATEST = "rss:status:latest";
const REDIS_KEY_HISTORY = "rss:status:history";
const HISTORY_MAX = 10;

export interface RssRunStats {
  releases_found: number;
  releases_grabbed: number;
  /** Grabs where Local AI chose the release (RSS auto-grab only). */
  releases_grabbed_by_ai: number;
  indexers: { name: string; releases_found: number }[];
}

export interface RssRunResult extends RssRunStats {
  status: "success" | "error";
  started_at: string;
  completed_at: string;
  error: string | null;
}

export async function saveRssRunResult(result: RssRunResult): Promise<void> {
  const json = JSON.stringify(result);
  await Promise.all([
    redis.set(REDIS_KEY_LATEST, json),
    redis
      .lpush(REDIS_KEY_HISTORY, json)
      .then(() => redis.ltrim(REDIS_KEY_HISTORY, 0, HISTORY_MAX - 1)),
  ]);
}

export async function getLastRssRun(): Promise<RssRunResult | null> {
  const raw = await redis.get(REDIS_KEY_LATEST);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RssRunResult;
  } catch {
    return null;
  }
}

export async function getRssRunHistory(): Promise<RssRunResult[]> {
  const items = await redis.lrange(REDIS_KEY_HISTORY, 0, -1);
  return items.flatMap((item) => {
    try {
      return [JSON.parse(item) as RssRunResult];
    } catch {
      return [];
    }
  });
}
