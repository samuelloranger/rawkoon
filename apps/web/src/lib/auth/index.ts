import type { User } from "@rawkoon/shared/types";
import type { QueryClient } from "@tanstack/react-query";
import { getQueryClient, invalidateAuthCache } from "@/lib/api/queryClient";
import { queryKeys } from "@/lib/queryKeys";
import { webFetcher } from "@/lib/api/fetcher";
import { ApiError } from "@/lib/api/client";
import { toast } from "sonner";
import { fetchAuthMeUser } from "@/lib/auth/fetchAuthMeUser";

let currentUser: User | null | undefined = undefined;
let userPromise: Promise<User | null> | null = null;

export async function getCurrentUser(): Promise<User | null> {
  if (currentUser !== undefined) {
    // Always re-seed the TQ cache on the fast path so components that mount
    // after navigation always find data and never flash a loading state.
    getQueryClient()?.setQueryData(queryKeys.auth.me, currentUser);
    return currentUser;
  }

  const cachedUser = getQueryClient()?.getQueryData<User | null>(
    queryKeys.auth.me,
  );
  if (cachedUser !== undefined) {
    currentUser = cachedUser;
    return cachedUser;
  }

  if (userPromise) {
    return userPromise;
  }

  userPromise = (async () => {
    try {
      currentUser = await fetchAuthMeUser(webFetcher);
      if (currentUser === null) {
        invalidateAuthCache();
      } else {
        getQueryClient()?.setQueryData(queryKeys.auth.me, currentUser);
      }
      return currentUser;
    } catch (error: unknown) {
      // If 429, show toast and re-throw so the router can avoid redirect
      if (error instanceof ApiError && error.status === 429) {
        toast.error("Too many requests. Please slow down.");
        throw error;
      }

      // For transient/non-auth errors, preserve any known user state and re-throw.
      // This prevents protected routes from redirecting to login due to flaky /me requests.
      const cachedUser = getQueryClient()?.getQueryData<User | null>(
        queryKeys.auth.me,
      );
      if (cachedUser !== undefined) {
        currentUser = cachedUser;
        return currentUser;
      }

      throw error;
    } finally {
      userPromise = null;
    }
  })();

  return userPromise;
}

export function clearUser(): void {
  currentUser = null;
  userPromise = null;
  // Invalidate React Query cache to ensure UI updates
  invalidateAuthCache();
}

export function setUser(user: User | null): void {
  currentUser = user;
  getQueryClient()?.setQueryData(queryKeys.auth.me, user);
}

export function resetUserCache(): void {
  currentUser = undefined;
  userPromise = null;
  getQueryClient()?.removeQueries({ queryKey: queryKeys.auth.me });
}

export function bootstrapAuthFromWindow(
  queryClient?: QueryClient,
): User | null {
  if (typeof window === "undefined") return null;

  const bootUser = window.__RAWKOON_BOOTSTRAP__?.user;
  if (bootUser === undefined) return null;

  currentUser = bootUser;
  queryClient?.setQueryData(queryKeys.auth.me, bootUser);
  return bootUser;
}
