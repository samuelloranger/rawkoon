import { useCallback } from "react";
import { useRouter } from "@tanstack/react-router";
import { navSections } from "@/lib/routing/navigation";

const ALL_NAV_PATHS = navSections.flatMap((s) => s.items.map((i) => i.path));

function runWhenIdle(fn: () => void): void {
  if (typeof window === "undefined") return;
  const ric = (
    window as typeof window & {
      requestIdleCallback?: (
        cb: () => void,
        opts?: { timeout: number },
      ) => number;
    }
  ).requestIdleCallback;
  if (ric) ric(fn, { timeout: 3000 });
  else setTimeout(fn, 1500);
}

/**
 * Warm every nav route (JS chunk + its loader data) — fire and forget,
 * deferred to browser idle. NOTE: router.preloadRoute runs each route's
 * loader, so this DOES fetch route data. Heavy at scale — only the
 * QuickActionPalette uses it (on open). The Sidebar relies on
 * defaultPreload:"intent" (hover) instead, to keep the dashboard light.
 */
export function usePrefetchAllRoutes() {
  const router = useRouter();

  return useCallback(() => {
    runWhenIdle(() => {
      for (const path of ALL_NAV_PATHS) {
        void router.preloadRoute({ to: path });
      }
    });
  }, [router]);
}
