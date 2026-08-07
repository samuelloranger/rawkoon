import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test-utils/render";
import { MergedEpisodeRow } from "./LibraryMergedEpisodeRow";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

function mutStub() {
  return { isPending: false, mutateAsync: vi.fn() } as never;
}

const EPISODE = {
  id: 1,
  episode: 1,
  title: "Some episode",
  air_date: "2020-01-15",
  status: "downloaded",
  monitored: true,
  search_attempts: 0,
};

// Expanding renders FileDetailBlock, which reads most of these directly.
const FILE = {
  id: 7,
  season: 2,
  episode: 1,
  file_name: "Show.S02E01.1080p.mkv",
  file_path: "/tv/Show/Show.S02E01.1080p.mkv",
  size_bytes: 1024,
  scanned_at: "2026-01-01T00:00:00Z",
  resolution: 1080,
  width: 1920,
  height: 1080,
  video_codec: "x264",
  video_profile: null,
  video_bitrate: null,
  bit_depth: null,
  frame_rate: null,
  hdr_format: null,
  duration_secs: 1800,
  source: "BluRay",
  release_group: "GROUP",
  audio_tracks: [],
  subtitle_tracks: [],
};

function renderRow(file: unknown) {
  return renderWithProviders(
    <MergedEpisodeRow
      ep={EPISODE}
      season={2}
      file={file as never}
      libraryId={1}
      t={((k: string) => k) as never}
      searchEpMut={mutStub()}
      retryEpMut={mutStub()}
      toggleMonitoredMut={mutStub()}
      deleteEpisodeMut={mutStub()}
    />,
  );
}

describe("MergedEpisodeRow interactive structure", () => {
  it("never nests a button inside another button", () => {
    const { container } = renderRow(FILE);

    // Invalid HTML: the browser closes the outer button early, so the row's
    // search / retry / monitor / delete controls escape their wrapper and React
    // warns on hydration.
    expect(container.querySelector("button button")).toBeNull();

    // The action buttons must still be present — a fix that simply dropped them
    // would also satisfy the assertion above.
    expect(container.querySelectorAll("button").length).toBeGreaterThan(1);
  });

  it("exposes the row as an expandable control when it has a file", () => {
    const { container } = renderRow(FILE);
    const row = container.querySelector('[role="button"]');

    expect(row).not.toBeNull();
    expect(row?.getAttribute("aria-expanded")).toBe("false");
    expect(row?.getAttribute("tabindex")).toBe("0");
  });

  it("toggles on click and on keyboard, matching the old button behaviour", () => {
    const { container } = renderRow(FILE);
    const row = container.querySelector('[role="button"]');
    if (!row) throw new Error("expandable row not found");

    fireEvent.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("true");

    fireEvent.keyDown(row, { key: "Enter" });
    expect(row.getAttribute("aria-expanded")).toBe("false");

    fireEvent.keyDown(row, { key: " " });
    expect(row.getAttribute("aria-expanded")).toBe("true");
  });

  it("is not a focus stop when there is nothing to expand", () => {
    const { container } = renderRow(null);

    // A file-less row has no detail block, so making it focusable would give
    // keyboard users a stop that does nothing.
    expect(container.querySelector('[role="button"]')).toBeNull();
    expect(screen.getAllByText("Some episode").length).toBeGreaterThan(0);
  });
});
