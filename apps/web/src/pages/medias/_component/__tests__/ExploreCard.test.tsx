import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { TmdbMediaSearchItem } from "@rawkoon/shared/types";
import { ExploreCard } from "../ExploreCard";

const auth = vi.hoisted(() => ({ isAdmin: false }));
const flow = vi.hoisted(() => ({
  add: vi.fn().mockResolvedValue(null),
  request: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/auth/useAuth", () => ({
  useCurrentUser: () => ({ data: { is_admin: auth.isAdmin } }),
}));
vi.mock("@/features/add/useAddFlow", () => ({
  useAddFlow: () => ({ ...flow, isAdding: false }),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ prefetchQuery: vi.fn() }),
}));
vi.mock("@/lib/api/context", () => ({ useFetcher: () => vi.fn() }));
vi.mock("@/pages/medias/_component/ExploreCardDetailDialog", () => ({
  ExploreCardDetailDialog: () => null,
}));

const item = {
  id: "tv-9",
  tmdb_id: 9,
  media_type: "tv",
  title: "A Show",
  release_year: 2022,
  poster_url: null,
  can_add: true,
  already_exists: false,
  library_id: null,
} as unknown as TmdbMediaSearchItem;

beforeEach(() => {
  flow.add.mockClear();
  flow.request.mockClear();
});

describe("ExploreCard quick action", () => {
  it("is Request for a non-admin and files a request instead of a 403ing add", async () => {
    auth.isAdmin = false;
    render(<ExploreCard item={item} />);
    fireEvent.click(screen.getByRole("button", { name: "Request A Show" }));
    expect(flow.request).toHaveBeenCalledWith({
      tmdb_id: 9,
      type: "show",
      title: "A Show",
      poster_url: null,
      year: 2022,
    });
    expect(flow.add).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Request A Show" }),
      ).toBeDisabled(),
    );
  });

  it("is Add for an admin and goes through the add flow", () => {
    auth.isAdmin = true;
    render(<ExploreCard item={item} />);
    fireEvent.click(screen.getByRole("button", { name: "Add A Show" }));
    expect(flow.add).toHaveBeenCalledWith(item);
    expect(flow.request).not.toHaveBeenCalled();
  });
});
