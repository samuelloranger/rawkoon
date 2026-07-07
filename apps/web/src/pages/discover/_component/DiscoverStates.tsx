import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Compass, Settings2 } from "lucide-react";

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-white/10 bg-neutral-900/60 p-10 text-center">
      {children}
    </div>
  );
}

export function DiscoverExhausted({ onReload }: { onReload?: () => void }) {
  return (
    <Shell>
      <Compass className="h-10 w-10 text-primary-400" />
      <h2 className="font-display text-xl font-semibold text-text-strong">
        You&apos;re all caught up
      </h2>
      <p className="max-w-sm text-sm text-text-muted">
        You&apos;ve seen every pick for now. Refresh for more, or add titles to
        sharpen future recommendations.
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        {onReload && (
          <button
            type="button"
            onClick={onReload}
            className="rounded-lg bg-primary-500 px-4 py-2 text-sm font-medium text-white"
          >
            Show more picks
          </button>
        )}
        <Link
          to="/explore"
          className="rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-text-strong"
        >
          Browse Explore
        </Link>
      </div>
    </Shell>
  );
}

export function DiscoverNotConfigured() {
  return (
    <Shell>
      <Settings2 className="h-10 w-10 text-primary-400" />
      <h2 className="font-display text-xl font-semibold text-text-strong">
        Connect TMDB to get picks
      </h2>
      <p className="max-w-sm text-sm text-text-muted">
        Discover needs TMDB enabled in Settings to recommend titles.
      </p>
      <Link
        to="/settings"
        search={{ tab: "profile" }}
        className="mt-2 rounded-lg bg-primary-500 px-4 py-2 text-sm font-medium text-white"
      >
        Open Settings
      </Link>
    </Shell>
  );
}

export function DiscoverError() {
  return (
    <Shell>
      <h2 className="font-display text-xl font-semibold text-text-strong">
        Couldn&apos;t load picks
      </h2>
      <p className="max-w-sm text-sm text-text-muted">
        Something went wrong reaching TMDB. Try again in a moment.
      </p>
    </Shell>
  );
}
