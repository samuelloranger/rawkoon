import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueuePage } from "../QueuePage";

let active: object = { enabled: true, connected: true, items: [] };
let pending: object = { items: [] };
let attention: object = { items: [] };

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    ...props
  }: {
    children: React.ReactNode;
    [key: string]: unknown;
  }) => <a {...(props as object)}>{children}</a>,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { count?: number }) =>
      o?.count != null ? `${k}:${o.count}` : k,
  }),
}));
let isAdmin = true;
vi.mock("@/lib/auth/useAuth", () => ({
  useCurrentUser: () => ({ data: { is_admin: isAdmin } }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/features/medias/hooks/useActiveDownloads", () => ({
  useActiveDownloads: () => ({ data: active, isLoading: false }),
}));
vi.mock("@/pages/_component/usePendingReleases", () => ({
  usePendingReleases: () => ({ data: pending }),
  useGrabPendingNow: () => ({
    isPending: false,
    variables: null,
    mutate: vi.fn(),
  }),
}));
vi.mock("@/pages/_component/useDownloadsSpeed", () => ({
  useDownloadsSpeed: () => ({
    data: { enabled: true, connected: true, dl_speed: 0 },
  }),
}));
vi.mock("@/features/medias/hooks/useLibraryAttention", () => ({
  useLibraryAttention: () => ({ data: attention }),
}));
vi.mock("@/features/medias/hooks/useRetryLibraryPostProcess", () => ({
  useRetryLibraryPostProcess: () => ({ isPending: false, mutate: vi.fn() }),
}));
vi.mock("@/features/medias/hooks/useDismissLibraryAttentionAlert", () => ({
  useDismissLibraryAttentionAlert: () => ({
    isPending: false,
    mutate: vi.fn(),
  }),
}));

const dl = (id: number, state: string, progress = 0.5) => ({
  id,
  media_id: id,
  media_title: `Title ${id}`,
  media_type: "movie",
  poster_url: null,
  season: null,
  episode: null,
  release_title: `Release ${id}`,
  progress,
  state,
  download_speed: 100,
  eta_seconds: 10,
});

describe("QueuePage", () => {
  it("renders each status with its reason, including failed rows from alerts", () => {
    active = {
      enabled: true,
      connected: true,
      items: [
        dl(1, "downloading"),
        dl(2, "stalled"),
        dl(3, "completed", 1),
        dl(4, "paused"),
      ],
    };
    pending = {
      items: [
        {
          target_key: "k",
          media_id: 9,
          media_title: "Held Title",
          poster_url: null,
          season: null,
          episode: null,
          release_title: "Held.Release",
          candidate_count: 2,
          grab_after: new Date(Date.now() + 3_600_000).toISOString(),
        },
      ],
    };
    attention = {
      items: [
        {
          id: 50,
          kind: "post_process_error",
          scope_type: "movie",
          media_id: 30,
          media_title: "Broken Import",
          media_type: "movie",
          episode_id: null,
          season: null,
          episode_number: null,
          detail: "Permission denied",
          search_attempts: null,
          library_status: null,
          download_history_id: 12,
          grabbed_at: null,
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
    };
    render(<QueuePage />);
    for (const status of [
      "downloading",
      "stalled",
      "importing",
      "waiting",
      "failed",
    ]) {
      expect(
        screen.getAllByText(`activity.queue.status.${status}`).length,
      ).toBeGreaterThan(0);
    }
    expect(screen.getByText("Permission denied")).toBeTruthy();
    expect(
      screen.getByText("dashboard.libraryAttention.retryPostProcess"),
    ).toBeTruthy();
    expect(screen.getByText("activity.queue.reason.importing")).toBeTruthy();
  });

  it("still lists held grabs and alerts when the download client is not configured", () => {
    active = { enabled: false, connected: false, items: [] };
    attention = { items: [] };
    pending = {
      items: [
        {
          target_key: "k",
          media_id: 9,
          media_title: "Held Title",
          poster_url: null,
          season: null,
          episode: null,
          release_title: "Held.Release",
          candidate_count: 1,
          grab_after: new Date(Date.now() + 3_600_000).toISOString(),
        },
      ],
    };
    render(<QueuePage />);
    expect(screen.getByText("Held Title")).toBeTruthy();
    expect(screen.getByText("dashboard.home.grabNow")).toBeTruthy();
    expect(
      screen.getByText("dashboard.home.downloadClientNotConfigured"),
    ).toBeTruthy();
  });

  it("points admins to settings and members to an admin when downloads are down", () => {
    active = { enabled: false, connected: false, items: [] };
    pending = { items: [] };
    attention = { items: [] };
    isAdmin = true;
    const { unmount } = render(<QueuePage />);
    expect(
      screen.getByText("dashboard.home.downloadClientOpenSettings"),
    ).toBeTruthy();
    unmount();
    isAdmin = false;
    render(<QueuePage />);
    expect(
      screen.getByText("dashboard.home.downloadsUnavailableAskAdmin"),
    ).toBeTruthy();
    isAdmin = true;
  });
});
