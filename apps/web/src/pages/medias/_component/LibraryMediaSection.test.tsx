import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test-utils/render";
import { LibraryMediaSection } from "./LibraryMediaSection";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

const LIBRARY_ID = 1;

/**
 * Regression for the screenshot-era report that a season mixing downloaded
 * past episodes with wanted future-air-date rows hard-crashed Chromium via an
 * SPA render loop.
 *
 * Mounts `LibraryMediaSection` rather than `MergedEpisodeRow` directly: the row
 * is a leaf whose only state is its own `expanded` flag, so rendering two of
 * them side by side cannot reproduce a loop no matter what the data looks like.
 * The season grouping and the `s.episodes.map(...)` that owns the mixed-status
 * shape live in the section, so that is what has to be mounted and expanded for
 * this test to be able to fail.
 */
describe("LibraryMediaSection mixed-status season", () => {
  const episodes = [
    {
      id: 1,
      season: 2,
      episode: 1,
      title: "Downloaded past",
      air_date: "2020-01-15",
      status: "downloaded",
      monitored: true,
      search_attempts: 0,
    },
    {
      id: 4,
      season: 2,
      episode: 4,
      title: "Wanted future",
      air_date: "2099-12-01",
      status: "wanted",
      monitored: true,
      search_attempts: 0,
    },
  ];

  function mountWithSeason() {
    const fetcher = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/files")) {
        return Promise.resolve({ media_type: "show", files: [] });
      }
      if (url.endsWith("/episodes")) {
        // One season carrying both statuses — the shape under test.
        return Promise.resolve({ seasons: [{ season: 2, episodes }] });
      }
      return Promise.resolve({});
    });
    return renderWithProviders(<LibraryMediaSection libraryId={LIBRARY_ID} />, {
      fetcher,
    });
  }

  it("renders a season holding both downloaded past and wanted future episodes", async () => {
    mountWithSeason();

    // Seasons render collapsed, so the mixed-status rows only mount once the
    // season toggle is clicked. `t` is stubbed to echo keys, hence the raw key.
    const label = await screen.findByText(/library\.media\.season/);
    const toggle = label.closest("button");
    expect(toggle).not.toBeNull();
    fireEvent.click(toggle!);

    // getAllByText, not getByText: each row renders its title twice for the
    // responsive layouts.
    await waitFor(() => {
      expect(screen.getAllByText("Downloaded past").length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText("Wanted future").length).toBeGreaterThan(0);
  });

  it("settles instead of re-rendering forever on that shape", async () => {
    const { fetcher } = mountWithSeason();

    const label = await screen.findByText(/library\.media\.season/);
    fireEvent.click(label.closest("button")!);
    // Sample only once the mixed rows are on screen, so the baseline is a
    // settled tree rather than a moment when the second query has yet to fire.
    await waitFor(() => {
      expect(screen.getAllByText("Wanted future").length).toBeGreaterThan(0);
    });

    // A render loop shows up here as an ever-growing call count.
    const settled = fetcher.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(fetcher.mock.calls.length).toBe(settled);
  });
});
