import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen, fireEvent } from "@/test-utils/render";
import type { MediaRequest } from "@rawkoon/shared/types";

const auth = vi.hoisted(() => ({ isAdmin: true }));
vi.mock("@/lib/auth/useAuth", () => ({
  useAuth: () => ({ user: { id: "u", is_admin: auth.isAdmin } }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
  }: {
    children: React.ReactNode;
    params?: object;
  }) => <a data-params={JSON.stringify(params)}>{children}</a>,
}));

const base: MediaRequest = {
  id: 1,
  tmdb_id: null,
  type: "book",
  title: "Livre A",
  author: "Auteur",
  poster_url: null,
  year: 2026,
  status: "pending",
  requested_by: { id: "m", name: "Marie" },
  quality_profile_id: null,
  library_media_id: null,
  google_volume_id: "vol-1",
  book_quality_profile_id: null,
  library_book_id: null,
  deny_reason: null,
  created_at: "2026-01-01T00:00:00Z",
  decided_at: null,
};
const rows = vi.hoisted(() => ({ list: [] as unknown[] }));
const approve = vi.fn();

vi.mock("@/pages/requests/_hooks/useRequests", () => ({
  useRequests: () => ({ data: { requests: rows.list }, isLoading: false }),
  useApproveRequest: () => ({ mutate: approve, isPending: false }),
  useDenyRequest: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/pages/settings/useQualityProfiles", () => ({
  useQualityProfilesList: () => ({
    data: { profiles: [{ id: 5, name: "Movie HD" }] },
  }),
}));
vi.mock("@/pages/books/_hooks/useBooks", () => ({
  useBookQualityProfiles: () => ({
    data: { profiles: [{ id: 9, name: "Epub only" }] },
  }),
}));

import { RequestsPage } from "./RequestsPage";

describe("RequestsPage book rows", () => {
  beforeEach(() => {
    auth.isAdmin = true;
    approve.mockClear();
    rows.list = [base];
  });

  it("shows the Book badge and author", () => {
    renderWithProviders(<RequestsPage />);
    expect(screen.getByText("requests.book")).toBeInTheDocument();
    expect(screen.getByText(/Auteur/)).toBeInTheDocument();
  });

  it("approves a book request with a book quality profile", () => {
    renderWithProviders(<RequestsPage />);
    expect(screen.queryByText("Movie HD")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "9" } });
    fireEvent.click(screen.getByText("requests.approve"));
    expect(approve).toHaveBeenCalledWith({ id: 1, quality_profile_id: 9 });
  });

  it("links to the book once it exists", () => {
    rows.list = [{ ...base, status: "approved", library_book_id: 42 }];
    renderWithProviders(<RequestsPage />);
    expect(screen.getByText("Livre A").closest("a")).toHaveAttribute(
      "data-params",
      JSON.stringify({ bookId: "42" }),
    );
  });

  it("shows a member only the status, no approve controls", () => {
    auth.isAdmin = false;
    renderWithProviders(<RequestsPage />);
    expect(screen.queryByText("requests.approve")).not.toBeInTheDocument();
    expect(screen.getByText("requests.status.pending")).toBeInTheDocument();
  });
});
