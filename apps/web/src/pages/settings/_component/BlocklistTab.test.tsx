import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { BlocklistEntry } from "@rawkoon/shared/types";

// react-i18next is globally mocked in src/test/setup.ts → t(key) returns key.
// formatDateTime is mocked so the test doesn't depend on locale formatting.
vi.mock("@rawkoon/shared/utils", () => ({
  formatDateTime: (v: string) => `formatted:${v}`,
}));

const useBlocklistMock = vi.fn();
const removeMutateAsync = vi.fn();
const confirmMock = vi.fn();

vi.mock("@/features/medias/hooks/useBlocklist", () => ({
  useBlocklist: () => useBlocklistMock(),
  useRemoveFromBlocklist: () => ({ mutateAsync: removeMutateAsync }),
}));

vi.mock("@/components/confirm/ConfirmContext", () => ({
  useConfirm: () => ({ confirm: confirmMock }),
}));

import { BlocklistTab } from "./BlocklistTab";

const ENTRY_A: BlocklistEntry = {
  id: 1,
  torrent_hash: "abc",
  release_title: "Some.Release.2024.1080p",
  indexer: "Prowlarr",
  media_id: 42,
  episode_id: null,
  reason: "Bad encode",
  blocked_at: "2026-06-01T10:00:00.000Z",
};

describe("BlocklistTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders blocked entries", () => {
    useBlocklistMock.mockReturnValue({
      data: { entries: [ENTRY_A] },
      isLoading: false,
      error: null,
    });

    render(<BlocklistTab />);

    // Release title appears (once per breakpoint layout).
    expect(
      screen.getAllByText("Some.Release.2024.1080p").length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("Prowlarr").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Bad encode").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("formatted:2026-06-01T10:00:00.000Z").length,
    ).toBeGreaterThan(0);
  });

  it("renders the empty state when there are no entries", () => {
    useBlocklistMock.mockReturnValue({
      data: { entries: [] },
      isLoading: false,
      error: null,
    });

    render(<BlocklistTab />);

    expect(screen.getByText("settings.blocklist.empty")).toBeInTheDocument();
  });
});
