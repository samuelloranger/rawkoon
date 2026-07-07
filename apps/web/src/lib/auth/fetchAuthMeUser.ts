import type { Fetcher } from "@/lib/api/context";
import { HttpError } from "@/lib/api/httpClient";
import { AUTH_ENDPOINTS } from "@/lib/endpoints";
import type { UserResponse } from "@rawkoon/shared/types";

/** Brief delay before retrying /me after 401 (cookie/session wake races). */
const UNAUTHORIZED_RETRY_DELAY_MS = 300;

/**
 * Fetches `/api/auth/me` for TanStack Query + router loaders.
 * Retries once on 401 so a transient failure after tab wake does not wipe `null` into cache.
 */
export async function fetchAuthMeUser(
  fetcher: Fetcher,
): Promise<UserResponse["user"]> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetcher<UserResponse>(AUTH_ENDPOINTS.ME);
      return response.user;
    } catch (error: unknown) {
      if (error instanceof HttpError && error.status === 401) {
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, UNAUTHORIZED_RETRY_DELAY_MS));
          continue;
        }
        return null;
      }
      throw error;
    }
  }
  return null;
}
