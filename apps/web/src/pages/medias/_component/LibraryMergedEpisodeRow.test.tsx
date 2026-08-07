import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test-utils/render";
import { MergedEpisodeRow } from "./LibraryMergedEpisodeRow";

// Interpolates, so assertions can see values passed into a label rather than
// just the key.
const stubT = (key: string, opts?: Record<string, unknown>) =>
  opts?.episode ? `${key}:${String(opts.episode)}` : key;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => stubT(key, opts),
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
      t={stubT as never}
      searchEpMut={mutStub()}
      retryEpMut={mutStub()}
      toggleMonitoredMut={mutStub()}
      deleteEpisodeMut={mutStub()}
    />,
  );
}

describe("MergedEpisodeRow interactive structure", () => {
  const toggleOf = (container: HTMLElement) =>
    container.querySelector<HTMLButtonElement>("button[aria-expanded]");

  it("never nests one interactive control inside another", () => {
    const { container } = renderRow(FILE);

    // A button inside a button is invalid HTML; role="button" around real
    // buttons is the ARIA equivalent, since ARIA treats a button's descendants
    // as presentational.
    expect(container.querySelector("button button")).toBeNull();
    expect(container.querySelector('[role="button"] button')).toBeNull();

    // A fix that simply deleted the action buttons would also satisfy that.
    expect(container.querySelectorAll("button").length).toBeGreaterThan(1);
  });

  it("exposes a real, labelled toggle button when the row has a file", () => {
    const { container } = renderRow(FILE);
    const toggle = toggleOf(container);

    expect(toggle).not.toBeNull();
    expect(toggle?.tagName).toBe("BUTTON");
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    // Names the episode: an explicit aria-label replaces the button contents,
    // so without this every row's toggle reads identically.
    expect(toggle?.getAttribute("aria-label")).toContain("E01");
    expect(toggle?.getAttribute("aria-label")).toContain("Some episode");
  });

  it("toggles the detail block from the toggle button", () => {
    const { container } = renderRow(FILE);
    const toggle = toggleOf(container);
    if (!toggle) throw new Error("toggle not found");

    fireEvent.click(toggle);
    expect(toggleOf(container)?.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(toggleOf(container)!);
    expect(toggleOf(container)?.getAttribute("aria-expanded")).toBe("false");
  });

  it("leaves keyboard activation of the action buttons alone", () => {
    const { container } = renderRow(FILE);
    const action = container.querySelector("button");
    if (!action) throw new Error("no action button rendered");

    // Nothing on the row may preventDefault on Enter/Space bubbling up from an
    // action button — that would swallow the button's own activation.
    fireEvent.keyDown(action, { key: "Enter", bubbles: true });
    fireEvent.keyDown(action, { key: " ", bubbles: true });
    expect(toggleOf(container)?.getAttribute("aria-expanded")).toBe("false");
  });

  it("offers no toggle when there is nothing to expand", () => {
    const { container } = renderRow(null);

    // A file-less row has no detail block, so a toggle would be a focus stop
    // that does nothing.
    expect(toggleOf(container)).toBeNull();
    expect(container.querySelector('[role="button"]')).toBeNull();
    expect(screen.getAllByText("Some episode").length).toBeGreaterThan(0);
  });
});
