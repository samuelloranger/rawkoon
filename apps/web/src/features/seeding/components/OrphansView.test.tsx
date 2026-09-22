import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const useOrphansMock = vi.fn();
const mutateAsync = vi.fn(async () => ({
  removed: ["aa"],
  refused: [],
  freed_bytes: 100,
}));
vi.mock("@/features/seeding/hooks/useOrphans", () => ({
  useOrphans: () => useOrphansMock(),
  useRemoveOrphans: () => ({ mutateAsync, isPending: false }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { OrphansView } from "./OrphansView";

const orphan = (hash: string, shares = false) => ({
  hash,
  name: `Name.${hash}`,
  category: "rawkoon-movies",
  size_bytes: 100,
  ratio: 1,
  seeding_time_secs: 3600,
  content_path: `/dl/${hash}`,
  shares_data: shares,
});

describe("OrphansView", () => {
  beforeEach(() => mutateAsync.mockClear());

  it("shows the action bar with totals once rows are selected", () => {
    useOrphansMock.mockReturnValue({
      isLoading: false,
      error: null,
      data: { orphans: [orphan("aa"), orphan("bb", true)], total_bytes: 200 },
    });
    render(<OrphansView />);
    expect(
      screen.queryByRole("region", { name: "orphans.selectAll" }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "orphans.selectAll" }),
    );
    expect(screen.getByText(/^orphans\.selected/)).toBeInTheDocument();
    expect(screen.getByText("orphans.sharedNote")).toBeInTheDocument();
  });

  it("removes the selected torrents with the delete-data choice", async () => {
    useOrphansMock.mockReturnValue({
      isLoading: false,
      error: null,
      data: { orphans: [orphan("aa")], total_bytes: 100 },
    });
    render(<OrphansView />);
    fireEvent.click(
      screen.getByRole("checkbox", { name: /^orphans\.select name:/ }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "orphans.deleteData" }),
    );
    fireEvent.click(screen.getByRole("button", { name: /^orphans\.remove/ }));
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        hashes: ["aa"],
        delete_data: false,
      }),
    );
  });

  it("explains an empty list", () => {
    useOrphansMock.mockReturnValue({
      isLoading: false,
      error: null,
      data: { orphans: [], total_bytes: 0 },
    });
    render(<OrphansView />);
    expect(screen.getByText("orphans.empty.title")).toBeInTheDocument();
  });
});
