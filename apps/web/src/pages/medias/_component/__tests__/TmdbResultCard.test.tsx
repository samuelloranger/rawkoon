import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { TmdbMediaSearchItem } from "@rawkoon/shared/types";
import { TmdbResultCard } from "../TmdbResultCard";

const navigate = vi.fn();
const addTitle = vi.fn();
let isAdmin = true;
let searchOnAdd = true;

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock("@/lib/auth/useAuth", () => ({
  useCurrentUser: () => ({ data: { is_admin: isAdmin } }),
}));
vi.mock("@/features/medias/hooks/useSearchOnAddEnabled", () => ({
  useSearchOnAddEnabled: () => searchOnAdd,
}));
vi.mock("@/features/medias/hooks/useAddTitle", () => ({
  useAddTitle: () => ({ addTitle, isAdding: false }),
}));

vi.mock("@/pages/medias/_component/RequestButton", () => ({
  RequestButton: () => <button type="button">request-button</button>,
}));

const item = (
  over: Partial<TmdbMediaSearchItem> = {},
): TmdbMediaSearchItem => ({
  id: "movie-1",
  tmdb_id: 1,
  media_type: "movie",
  title: "Some Title",
  release_year: 2020,
  poster_url: null,
  overview: null,
  vote_average: null,
  already_exists: false,
  can_add: true,
  source_id: null,
  library_id: null,
  library_status: null,
  ...over,
});

describe("TmdbResultCard", () => {
  beforeEach(() => {
    navigate.mockReset();
    addTitle.mockReset();
    isAdmin = true;
    searchOnAdd = true;
  });

  it("adds in one click using the server's search-on-add default", async () => {
    addTitle.mockResolvedValue({ item: { id: 7 } });
    const onAdded = vi.fn();
    render(
      <TmdbResultCard
        item={item()}
        onOpenDetails={vi.fn()}
        onAdded={onAdded}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "medias.tmdb.addAction" }),
    );
    await waitFor(() => expect(onAdded).toHaveBeenCalled());
    expect(addTitle).toHaveBeenCalledWith(
      expect.objectContaining({ tmdb_id: 1 }),
      {
        searchOnAdd: undefined,
      },
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it("Choose release adds without searching and opens the item's Search tab", async () => {
    addTitle.mockResolvedValue({ item: { id: 7 } });
    render(
      <TmdbResultCard
        item={item()}
        onOpenDetails={vi.fn()}
        onAdded={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "medias.tmdb.chooseRelease" }),
    );
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(addTitle).toHaveBeenCalledWith(expect.anything(), {
      searchOnAdd: false,
      silent: true,
    });
    expect(navigate).toHaveBeenCalledWith({
      to: "/library/$libraryId",
      params: { libraryId: "7" },
      search: { tab: "releases" },
    });
  });

  it("does not navigate when the add fails", async () => {
    addTitle.mockResolvedValue(null);
    render(
      <TmdbResultCard
        item={item()}
        onOpenDetails={vi.fn()}
        onAdded={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "medias.tmdb.chooseRelease" }),
    );
    await waitFor(() => expect(addTitle).toHaveBeenCalled());
    expect(navigate).not.toHaveBeenCalled();
  });

  it("opens the details dialog from the card body", () => {
    const onOpenDetails = vi.fn();
    render(
      <TmdbResultCard
        item={item()}
        onOpenDetails={onOpenDetails}
        onAdded={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Some Title"));
    expect(onOpenDetails).toHaveBeenCalled();
  });

  it("shows the library status and only an Open action for a title already in the library", () => {
    render(
      <TmdbResultCard
        item={item({
          already_exists: true,
          library_id: 5,
          library_status: "wanted",
        })}
        onOpenDetails={vi.fn()}
        onAdded={vi.fn()}
      />,
    );
    expect(
      screen.getByText("medias.library.itemStatus.wanted"),
    ).toBeInTheDocument();
    expect(screen.queryByText("medias.tmdb.addAction")).not.toBeInTheDocument();
    expect(
      screen.queryByText("medias.tmdb.chooseRelease"),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "medias.tmdb.openInLibrary" }),
    );
    expect(navigate).toHaveBeenCalledWith({
      to: "/library/$libraryId",
      params: { libraryId: "5" },
      search: undefined,
    });
  });

  it("navigates to the existing item when Choose release hits a title another user already added", async () => {
    addTitle.mockResolvedValue({ item: { id: 42 } });
    render(
      <TmdbResultCard
        item={item()}
        onOpenDetails={vi.fn()}
        onAdded={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "medias.tmdb.chooseRelease" }),
    );
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({ params: { libraryId: "42" } }),
    );
  });

  it("opens details when the title is in the library but has no library id", () => {
    const onOpenDetails = vi.fn();
    render(
      <TmdbResultCard
        item={item({ already_exists: true, library_id: null })}
        onOpenDetails={onOpenDetails}
        onAdded={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Some Title"));
    expect(onOpenDetails).toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("offers no add actions to a non-admin", () => {
    isAdmin = false;
    render(
      <TmdbResultCard
        item={item()}
        onOpenDetails={vi.fn()}
        onAdded={vi.fn()}
      />,
    );
    expect(screen.queryByText("medias.tmdb.addAction")).not.toBeInTheDocument();
  });

  it("shows Request instead of Add for members when not in the library", () => {
    isAdmin = false;
    render(
      <TmdbResultCard
        item={item()}
        onOpenDetails={vi.fn()}
        onAdded={vi.fn()}
      />,
    );
    expect(screen.getByText("request-button")).toBeTruthy();
    expect(screen.queryByText("medias.tmdb.addAction")).toBeNull();
  });

  it("hides Request for members when the title is already in the library", () => {
    isAdmin = false;
    render(
      <TmdbResultCard
        item={item({ already_exists: true, library_id: 3 })}
        onOpenDetails={vi.fn()}
        onAdded={vi.fn()}
      />,
    );
    expect(screen.queryByText("request-button")).toBeNull();
  });
});
