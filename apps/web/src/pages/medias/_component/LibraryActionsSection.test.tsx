import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const removeMutateAsync = vi.fn(async () => ({ success: true }));
const downloadsMock = vi.fn();
const seedingMock = vi.fn();
vi.mock("@/features/medias/hooks/useRemoveFromLibrary", () => ({
  useRemoveFromLibrary: () => ({
    mutateAsync: removeMutateAsync,
    isPending: false,
  }),
}));
vi.mock("@/features/medias/hooks/useRetrySkippedMedia", () => ({
  useRetrySkippedMedia: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/features/medias/hooks/useToggleMediaMonitored", () => ({
  useToggleMediaMonitored: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/features/medias/hooks/useLibraryDownloads", () => ({
  useLibraryDownloads: () => downloadsMock(),
}));
vi.mock("@/features/seeding/hooks/useSeeding", () => ({
  useSeeding: () => seedingMock(),
}));

import { LibraryActionsSection } from "./LibraryActionsSection";

const HELD = {
  items: [
    {
      id: 1,
      torrent_hash: "AA",
      seed: {
        state: "seeding",
        reason: null,
        ratio: 0.2,
        seeding_time_secs: 10,
      },
    },
  ],
};

describe("LibraryActionsSection remove", () => {
  beforeEach(() => {
    removeMutateAsync.mockClear();
    seedingMock.mockReturnValue({
      data: {
        torrents: [
          {
            hash: "aa",
            owes_seed_time: true,
            target_met: false,
            ratio: 0.4,
            rule: { ratio: 10, seed_time_mins: null },
            size_bytes: 2 * 1024 ** 3,
          },
        ],
      },
    });
  });

  const openConfirm = () =>
    fireEvent.click(
      screen.getByRole("button", { name: "library.management.delete" }),
    );

  it("offers keep-seeding vs remove-now when torrents are held, warning about a hit-and-run", async () => {
    downloadsMock.mockReturnValue({ data: HELD });
    render(<LibraryActionsSection libraryId={5} />);
    openConfirm();
    expect(
      screen.getByText(/^library\.management\.seedingTitle/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("library.management.releaseNow"));
    expect(
      screen.getByText("library.management.hnrWarning"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /library.management.deleteConfirm/ }),
    );
    await waitFor(() =>
      expect(removeMutateAsync).toHaveBeenCalledWith({
        id: 5,
        deleteFiles: true,
        releaseTorrents: true,
      }),
    );
  });

  it("shows no seeding choice when nothing is held", () => {
    downloadsMock.mockReturnValue({ data: { items: [] } });
    render(<LibraryActionsSection libraryId={5} />);
    openConfirm();
    expect(screen.queryByText(/^library\.management\.seedingTitle/)).toBeNull();
  });

  it("says what is still owed and how much space removing frees", () => {
    downloadsMock.mockReturnValue({ data: HELD });
    render(<LibraryActionsSection libraryId={5} />);
    openConfirm();
    expect(
      screen.getByText(
        /^library\.management\.keepSeedingHintRatio ratio:0\.40 target:10\.0/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/^library\.management\.releaseNowHintSize size:2/),
    ).toBeInTheDocument();
  });
});
