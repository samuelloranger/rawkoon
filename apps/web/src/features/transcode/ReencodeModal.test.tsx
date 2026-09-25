import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test-utils/render";

const estimate = {
  files: [
    {
      file_id: 1,
      title: "A",
      source_bytes: "4000000000",
      estimated_bytes: "1500000000",
      nlink: 2,
      duration_secs: 3000,
    },
  ],
  excluded: [{ file_id: 2, title: "B", reason: "Already queued" }],
  total_source_bytes: "4000000000",
  total_estimated_bytes: "1500000000",
  total_duration_secs: 3000,
  total_audio_bytes: "100000000",
  range_pct: 15,
  frees_now_bytes: "0",
  frees_after_seeding_bytes: "2500000000",
  temporary_growth_bytes: "1500000000",
  eta_secs: 600,
  source: "rough",
  refined_files: 0,
  refined_clips: 0,
  audio_changes: [{ label: "ENG · TRUEHD 8ch", to: "EAC3 768k" }],
  source_height: 1080,
};
const refineMutate = vi.fn(async () => ({
  ...estimate,
  source: "refined",
  refined_files: 1,
  refined_clips: 6,
}));
const enqueueMutate = vi.fn(async (_body: unknown) => ({
  batch_id: "b",
  count: 1,
}));

vi.mock("@/features/transcode/hooks", () => ({
  useTranscodeCapabilities: () => ({
    data: {
      combos: [
        { codec: "hevc", encoder: "software" },
        { codec: "av1", encoder: "software" },
      ],
      device_label: null,
      vaapi_unavailable_reason: "No GPU",
    },
  }),
  useTranscodeEstimate: () => ({ data: estimate, isFetching: false }),
  useRefineTranscodeEstimate: () => ({
    mutateAsync: refineMutate,
    isPending: false,
  }),
  useEnqueueTranscode: () => ({ mutateAsync: enqueueMutate, isPending: false }),
}));

const { ReencodeModal } = await import("@/features/transcode/ReencodeModal");

describe("ReencodeModal", () => {
  beforeEach(() => {
    refineMutate.mockClear();
    enqueueMutate.mockClear();
  });

  const open = () =>
    renderWithProviders(
      <ReencodeModal
        isOpen
        onClose={() => {}}
        selection={{ media_id: 1 }}
        subtitle="Show · 2 files"
      />,
    );

  it("disables GPU with the reason and 1080p for a 1080p source", () => {
    open();
    expect(
      screen.getByRole("radio", { name: "transcode.encoderGpu" }),
    ).toBeDisabled();
    expect(screen.getByRole("radio", { name: "1080p" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "720p" })).not.toBeDisabled();
  });

  it("shows exclusions and the seeding warning", () => {
    open();
    expect(
      screen.getByText("transcode.excludedTitle count:1"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Already queued/)).toBeInTheDocument();
    expect(
      screen.getByText(/^transcode.estimate.seedingWarning count:1/),
    ).toBeInTheDocument();
  });

  it("marks a refined estimate outdated after a settings change", async () => {
    open();
    fireEvent.click(
      screen.getByRole("button", { name: "transcode.estimate.refine" }),
    );
    await waitFor(() =>
      expect(
        screen.getByText("transcode.estimate.refined files:1 clips:6"),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("radio", { name: /AV1/ }));
    expect(screen.getByText("transcode.estimate.outdated")).toBeInTheDocument();
  });

  it("switching to target mode hides refine", () => {
    open();
    fireEvent.click(
      screen.getByRole("radio", { name: "transcode.modeTarget" }),
    );
    expect(
      screen.queryByRole("button", { name: /transcode.estimate.refine/ }),
    ).toBeNull();
    expect(screen.getByLabelText(/transcode.gbPerFile/)).toBeInTheDocument();
  });

  it("submits the selection and settings", async () => {
    open();
    fireEvent.click(
      screen.getByRole("button", { name: "transcode.submit count:1" }),
    );
    await waitFor(() => expect(enqueueMutate).toHaveBeenCalledTimes(1));
    expect(enqueueMutate.mock.calls[0][0]).toMatchObject({
      selection: { media_id: 1 },
      settings: { codec: "hevc", encoder: "software", mode: "quality" },
    });
  });
});

describe("ReencodeModal resolution box", () => {
  it("allows 1080p for a wide source taller than 1080 wide-box but under 1080 high", () => {
    estimate.source_height = 1072;
    (estimate as Record<string, unknown>).source_width = 2560;
    renderWithProviders(
      <ReencodeModal
        isOpen
        onClose={() => {}}
        selection={{ media_id: 1 }}
        subtitle="x"
      />,
    );
    expect(screen.getByRole("radio", { name: "1080p" })).not.toBeDisabled();
    estimate.source_height = 1080;
    delete (estimate as Record<string, unknown>).source_width;
  });
});
