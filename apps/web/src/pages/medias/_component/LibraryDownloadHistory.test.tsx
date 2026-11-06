import { describe, expect, it, vi } from "vitest";
import type { LibraryDownloadHistoryItem } from "@rawkoon/shared/types";
import { renderWithProviders, screen } from "@/test-utils/render";

const downloadsMock = vi.fn();
vi.mock("@/features/medias/hooks/useLibraryDownloads", () => ({
  useLibraryDownloads: () => downloadsMock(),
}));
vi.mock("@/features/medias/hooks/useDeleteLibraryDownloadEntry", () => ({
  useDeleteLibraryDownloadEntry: () => ({ isPending: false, mutate: vi.fn() }),
}));
vi.mock("@/features/medias/hooks/useClearLibraryFailedDownloads", () => ({
  useClearLibraryFailedDownloads: () => ({ isPending: false, mutate: vi.fn() }),
}));
vi.mock("@/features/medias/hooks/useLibraryDownloadAction", () => ({
  useLibraryDownloadAction: () => ({ isPending: false, mutate: vi.fn() }),
}));

import { LibraryDownloadHistory } from "./LibraryDownloadHistory";

function row(
  over: Partial<LibraryDownloadHistoryItem>,
): LibraryDownloadHistoryItem {
  return {
    id: 1,
    release_title: "A.Movie.2026.MULTI-GROUP",
    indexer: null,
    torrent_hash: "abc",
    grabbed_at: "2026-01-01T00:00:00Z",
    completed_at: null,
    failed: false,
    fail_reason: null,
    episode_id: null,
    live: null,
    ...over,
  };
}

const mount = () =>
  renderWithProviders(<LibraryDownloadHistory libraryId={5} />);

describe("LibraryDownloadHistory release-info chips", () => {
  it("shows torrent site, size, quality and HDR as chips on a completed row", () => {
    downloadsMock.mockReturnValue({
      data: {
        items: [
          row({
            completed_at: "2026-01-02T00:00:00Z",
            indexer: "Nimbus",
            size_bytes: 2_000_000_000,
            quality_parsed: {
              resolution: 1080,
              source: "BluRay",
              codec: "x265",
              hdr: "DV",
            },
          }),
        ],
      },
      isLoading: false,
    });
    mount();
    expect(screen.getByText("Nimbus")).toBeInTheDocument();
    expect(screen.getByText("2 GB")).toBeInTheDocument();
    expect(screen.getByText("1080p · BluRay · x265")).toBeInTheDocument();
    expect(screen.getByText("DV")).toBeInTheDocument();
  });

  it("shows live seeds/peers on an in-flight row, and omits absent chips", () => {
    downloadsMock.mockReturnValue({
      data: {
        items: [
          row({
            live: {
              progress: 0.5,
              download_speed: 1024,
              eta_seconds: 60,
              state: "downloading",
              seeds: 3,
              peers: 2,
            },
          }),
        ],
      },
      isLoading: false,
    });
    mount();
    // The mocked t() appends the interpolated values to the key.
    expect(
      screen.getByText(
        "medias.interactive.seedersLeechers seeders:3 leechers:2",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/GB/)).toBeNull();
    expect(screen.queryByText(/BluRay/)).toBeNull();
    expect(screen.queryByText(/·/)).toBeNull();
  });

  it("renders no chips beyond the date when nothing is known", () => {
    downloadsMock.mockReturnValue({
      data: { items: [row({})] },
      isLoading: false,
    });
    mount();
    expect(screen.queryByText(/seedersLeechers/)).toBeNull();
    expect(screen.queryByText(/GB/)).toBeNull();
  });
});
