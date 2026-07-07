import { RedisClient } from "bun";
import { getRedisUrl } from "@rawkoon/api/config";

let redisClient: RedisClient | null = null;
let redisDisabled = false;

const getRedisClient = (): RedisClient | null => {
  if (redisDisabled) return null;
  if (redisClient) return redisClient;

  try {
    redisClient = new RedisClient(getRedisUrl());
    return redisClient;
  } catch (error) {
    redisDisabled = true;
    console.error("Failed to initialize Redis client:", error);
    return null;
  }
};

export const getJsonCache = async <T>(key: string): Promise<T | null> => {
  const client = getRedisClient();
  if (!client) return null;

  try {
    const cached = await client.get(key);
    if (!cached) return null;
    return JSON.parse(cached) as T;
  } catch (error) {
    console.warn(`Redis get failed for key ${key}:`, error);
    return null;
  }
};

export const setJsonCache = async <T>(
  key: string,
  value: T,
  ttlSeconds: number,
): Promise<void> => {
  const client = getRedisClient();
  if (!client) return;

  try {
    // Single atomic SET with EX so the key never persists without its TTL.
    await client.send("SET", [
      key,
      JSON.stringify(value),
      "EX",
      String(ttlSeconds),
    ]);
  } catch (error) {
    console.warn(`Redis set failed for key ${key}:`, error);
  }
};

// Atomic SET NX EX. Returns true if the lock was acquired (or if Redis is
// unavailable — fail-open, matching the rest of this module's degrade-to-no-cache
// behavior). Pair with releaseLock in a finally.
export const acquireLock = async (
  key: string,
  ttlSeconds: number,
): Promise<boolean> => {
  const client = getRedisClient();
  if (!client) return true;
  try {
    const res = await client.send("SET", [
      key,
      "1",
      "NX",
      "EX",
      String(ttlSeconds),
    ]);
    return res === "OK";
  } catch (error) {
    console.warn(`Redis lock acquire failed for key ${key}:`, error);
    return true;
  }
};

export const releaseLock = async (key: string): Promise<void> => {
  await deleteCache(key);
};

export const deleteCache = async (key: string): Promise<void> => {
  const client = getRedisClient();
  if (!client) return;

  try {
    await client.send("DEL", [key]);
  } catch (error) {
    console.warn(`Redis delete failed for key ${key}:`, error);
  }
};
