import { RedisClient } from "bun";
import { getValkeyUrl } from "@rawkoon/api/config";

let valkeyClient: RedisClient | null = null;
let valkeyDisabled = false;

const getValkeyClient = (): RedisClient | null => {
  if (valkeyDisabled) return null;
  if (valkeyClient) return valkeyClient;

  try {
    valkeyClient = new RedisClient(getValkeyUrl());
    return valkeyClient;
  } catch (error) {
    valkeyDisabled = true;
    console.error("Failed to initialize Valkey client:", error);
    return null;
  }
};

export const getJsonCache = async <T>(key: string): Promise<T | null> => {
  const client = getValkeyClient();
  if (!client) return null;

  try {
    const cached = await client.get(key);
    if (!cached) return null;
    return JSON.parse(cached) as T;
  } catch (error) {
    console.warn(`Valkey get failed for key ${key}:`, error);
    return null;
  }
};

export const setJsonCache = async <T>(
  key: string,
  value: T,
  ttlSeconds: number,
): Promise<void> => {
  const client = getValkeyClient();
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
    console.warn(`Valkey set failed for key ${key}:`, error);
  }
};

/**
 * Same write as setJsonCache but reports whether it landed. For fail-closed
 * callers (MCP confirmations): a swallowed error there would hand out a
 * confirm token that can never be redeemed.
 */
export const setJsonCacheChecked = async <T>(
  key: string,
  value: T,
  ttlSeconds: number,
): Promise<boolean> => {
  const client = getValkeyClient();
  if (!client) return false;

  try {
    await client.send("SET", [
      key,
      JSON.stringify(value),
      "EX",
      String(ttlSeconds),
    ]);
    return true;
  } catch (error) {
    console.warn(`Valkey set failed for key ${key}:`, error);
    return false;
  }
};

export const deleteCache = async (key: string): Promise<void> => {
  const client = getValkeyClient();
  if (!client) return;

  try {
    await client.send("DEL", [key]);
  } catch (error) {
    console.warn(`Valkey delete failed for key ${key}:`, error);
  }
};

/** Counts up within a fixed window; the TTL is set once (NX) on first write. */
export const incrCache = async (
  key: string,
  ttlSeconds: number,
): Promise<number | null> => {
  const client = getValkeyClient();
  if (!client) return null;

  try {
    const count = Number(await client.send("INCR", [key]));
    // EXPIRE NX keeps the original window even on a concurrent first write.
    await client.send("EXPIRE", [key, String(ttlSeconds), "NX"]);
    return count;
  } catch (error) {
    console.warn(`Valkey incr failed for key ${key}:`, error);
    return null;
  }
};

/** Seconds until the key expires; -2 when missing, -1 when it has no TTL. */
export const ttlCache = async (key: string): Promise<number> => {
  const client = getValkeyClient();
  if (!client) return -2;

  try {
    return Number(await client.send("TTL", [key]));
  } catch {
    return -2;
  }
};

/** Read-and-delete in one command, so a stored token can't be used twice. */
export const takeJsonCache = async <T>(key: string): Promise<T | null> => {
  const client = getValkeyClient();
  if (!client) return null;

  try {
    const cached = await client.send("GETDEL", [key]);
    if (!cached) return null;
    return JSON.parse(String(cached)) as T;
  } catch (error) {
    console.warn(`Valkey take failed for key ${key}:`, error);
    return null;
  }
};
