import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test-utils/render";

const actions = {
  isPending: false,
  cancel: vi.fn(async () => {}),
  retry: vi.fn(async () => {}),
  moveTop: vi.fn(async () => {}),
  moveBefore: vi.fn(async () => {}),
  moveAfter: vi.fn(async () => {}),
  removeBatch: vi.fn(async () => {}),
  batchTop: vi.fn(async () => {}),
  clearHistory: vi.fn(async () => {}),
};
const update = vi.fn();
const settings = {
  codec: "hevc",
  encoder: "software",
  resolution: "keep",
  mode: "quality",
  preset: "balanced",
  speed: "default",
  convertLosslessAudio: false,
};
const mk = (id: number, status: string, extra: object = {}) => ({
  id,
  status,
  batch_id: "b1",
  title: `Item ${id}`,
  position: id,
  step: null,
  settings,
  source_bytes: "4000000000",
  estimated_bytes: "1500000000",
  output_bytes: null,
  source_nlink: 1,
  progress: null,
  ssim_avg: null,
  ssim_min: null,
  error: null,
  created_at: "2026-01-01T00:00:00Z",
  started_at: null,
  finished_at: null,
  poster_url: null,
  live: null,
  media_id: 1,
  media_file_id: id,
  ...extra,
});

vi.mock("@/features/transcode/hooks", () => ({
  useTranscodeJobs: (s: string) => ({
    data: {
      jobs:
        s === "active"
          ? [
              mk(1, "running", {
                step: "encode",
                live: {
                  progress: 0.5,
                  fps: 100,
                  speed: 4,
                  eta_secs: 60,
                  current_bytes: "700000000",
                },
              }),
              mk(2, "queued"),
              mk(3, "queued"),
            ]
          : [
              mk(9, "failed", {
                error: "Quality check: SSIM 0.951 below 0.970",
                ssim_avg: 0.951,
                finished_at: "2026-01-01T01:00:00Z",
              }),
            ],
    },
  }),
  useTranscodeSettings: () => ({
    data: {
      paused: false,
      window_enabled: false,
      window_start: "01:00",
      window_end: "08:00",
      ssim_threshold: 0.97,
      ssim_clip_min: 0.95,
      cpu_threads: null,
    },
  }),
  useUpdateTranscodeSettings: () => ({ mutate: update }),
  useTranscodeSummary: () => ({
    data: {
      state: "running",
      queued_count: 2,
      queued_eta_secs: 100,
      queued_source_bytes: "8000000000",
      saved_bytes_30d: "0",
      done_count_30d: 0,
      frees_after_seeding_bytes: "0",
      failed_count: 1,
      window_start: "01:00",
    },
  }),
  useTranscodeJobAction: () => actions,
}));

const { TranscodeTab } = await import(
  "@/pages/settings/_component/TranscodeTab"
);

describe("TranscodeTab", () => {
  it("shows the current job with its step", () => {
    renderWithProviders(<TranscodeTab />);
    expect(screen.getByText("transcode.admin.now")).toBeInTheDocument();
    expect(
      screen.getByText("transcode.admin.steps.encode 50%"),
    ).toBeInTheDocument();
  });

  it("pauses the queue", () => {
    renderWithProviders(<TranscodeTab />);
    fireEvent.click(
      screen.getByRole("button", { name: "transcode.admin.pause" }),
    );
    expect(update).toHaveBeenCalledWith({ paused: true });
  });

  it("moves a queued job to the top", () => {
    renderWithProviders(<TranscodeTab />);
    const buttons = screen.getAllByRole("button", {
      name: "transcode.admin.moveTop",
    });
    fireEvent.click(buttons[buttons.length - 1]);
    expect(actions.moveTop).toHaveBeenCalledWith(3);
  });

  it("drag-and-drop calls moveBefore", () => {
    renderWithProviders(<TranscodeTab />);
    const rows = screen.getAllByTestId("queue-row");
    fireEvent.dragStart(rows[1]);
    fireEvent.drop(rows[0]);
    expect(actions.moveBefore).toHaveBeenCalledWith(3, 2);
  });

  it("shows the failure reason and retries", () => {
    renderWithProviders(<TranscodeTab />);
    expect(screen.getByText(/SSIM 0.951 below 0.970/)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /transcode.admin.retry/ }),
    );
    expect(actions.retry).toHaveBeenCalledWith(9);
  });
});
