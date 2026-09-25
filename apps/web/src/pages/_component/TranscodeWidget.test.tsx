import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test-utils/render";

let user: { is_admin: boolean } | null = { is_admin: true };
let summary: Record<string, unknown> | undefined;
vi.mock("@/lib/auth/useAuth", () => ({
  useCurrentUser: () => ({ data: user }),
}));
vi.mock("@/features/transcode/hooks", () => ({
  useTranscodeSummary: () => ({ data: summary }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => (
    <a href="/settings">{children}</a>
  ),
}));

const { TranscodeWidget } = await import("@/pages/_component/TranscodeWidget");

const job = (id: number, title: string) => ({
  id,
  title,
  source_bytes: "4600000000",
  settings: { codec: "hevc", encoder: "vaapi" },
  poster_url: null,
  live: {
    progress: 0.62,
    fps: 214,
    speed: 8.9,
    eta_secs: 360,
    current_bytes: "1",
  },
});

describe("TranscodeWidget", () => {
  it("renders nothing for non-admins", () => {
    user = { is_admin: false };
    summary = { show: true };
    const { container } = renderWithProviders(<TranscodeWidget />);
    expect(container).toBeEmptyDOMElement();
    user = { is_admin: true };
  });

  it("renders nothing when the summary says hide", () => {
    summary = { show: false };
    const { container } = renderWithProviders(<TranscodeWidget />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the running job, next items and totals", () => {
    summary = {
      show: true,
      state: "running",
      window_start: "01:00",
      current: job(1, "Show — S03E07"),
      next: [job(2, "Show — S03E08"), job(3, "Show — S03E09")],
      queued_count: 60,
      queued_eta_secs: 32400,
      saved_bytes_30d: "187000000000",
      done_count_30d: 34,
      failed_count: 1,
    };
    renderWithProviders(<TranscodeWidget />);
    expect(screen.getByText("transcode.widget.running")).toBeInTheDocument();
    expect(screen.getByText("Show — S03E07")).toBeInTheDocument();
    expect(screen.getByText(/62%/)).toBeInTheDocument();
    expect(screen.getByText("Show — S03E08")).toBeInTheDocument();
    expect(
      screen.getByText("transcode.widget.more count:58"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/^transcode.widget.saved size:187.0 GB count:34/),
    ).toBeInTheDocument();
    expect(
      screen.getByText("transcode.widget.failed count:1"),
    ).toBeInTheDocument();
  });

  it("shows the waiting-window state", () => {
    summary = {
      show: true,
      state: "waiting_window",
      window_start: "01:00",
      current: null,
      next: [],
      queued_count: 3,
      queued_eta_secs: 100,
      saved_bytes_30d: "0",
      done_count_30d: 0,
      failed_count: 0,
    };
    renderWithProviders(<TranscodeWidget />);
    expect(
      screen.getByText("transcode.widget.waits time:01:00"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("transcode.widget.queued count:3"),
    ).toBeInTheDocument();
  });
});
