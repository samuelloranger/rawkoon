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
  season_mode: null,
  seasons: [],
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
const rows = vi.hoisted(() => ({ list: [] as unknown[], failed: false }));
const settings = vi.hoisted(() => ({ show: null as number | null }));
const refetch = vi.fn();
const deny = vi.fn();
const approve = vi.fn();
const remove = vi.fn();

vi.mock("@/pages/activity/requests/_hooks/useRequests", () => ({
  useRequests: () => ({
    data: rows.failed ? undefined : { requests: rows.list },
    isLoading: false,
    isError: rows.failed,
    refetch,
    isRefetching: false,
  }),
  useApproveRequest: () => ({ mutate: approve, isPending: false }),
  useDenyRequest: () => ({ mutate: deny, isPending: false }),
  useDeleteRequest: () => ({ mutate: remove, isPending: false }),
}));
vi.mock("@/pages/settings/useQualityProfiles", () => ({
  useQualityProfilesList: () => ({
    data: {
      profiles: [
        { id: 5, name: "Movie HD" },
        { id: 6, name: "Show 4K" },
      ],
    },
  }),
}));
vi.mock("@/features/medias/hooks/useMediaPostProcessingSettings", () => ({
  useMediaPostProcessingSettings: () => ({
    data: {
      settings: {
        default_movie_quality_profile_id: 5,
        default_show_quality_profile_id: settings.show,
      },
    },
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

describe("RequestsPage show rows", () => {
  const show = {
    ...base,
    type: "show" as const,
    tmdb_id: 7,
    season_mode: "pick" as const,
    seasons: [5],
  };

  beforeEach(() => {
    auth.isAdmin = true;
    approve.mockClear();
    rows.list = [show];
  });

  it("shows the requested seasons as pills and lets an admin change them", () => {
    renderWithProviders(<RequestsPage />);
    expect(screen.getByText("addDialog.seasonLabel n:5")).toBeInTheDocument();
    expect(screen.getByText("addDialog.changeSeasons")).toBeInTheDocument();
  });

  it("approves with the requester's seasons when the admin changes nothing", () => {
    renderWithProviders(<RequestsPage />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "5" } });
    fireEvent.click(screen.getByText("requests.approve"));
    expect(approve).toHaveBeenCalledWith({ id: 1, quality_profile_id: 5 });
  });

  it("shows a member the pills without the change control", () => {
    auth.isAdmin = false;
    renderWithProviders(<RequestsPage />);
    expect(screen.getByText("addDialog.seasonLabel n:5")).toBeInTheDocument();
    expect(
      screen.queryByText("addDialog.changeSeasons"),
    ).not.toBeInTheDocument();
  });
});

describe("RequestsPage delete button", () => {
  beforeEach(() => {
    auth.isAdmin = false;
    remove.mockClear();
  });

  it("lets the requester withdraw their own pending request", () => {
    rows.list = [{ ...base, requested_by: { id: "u", name: "Me" } }];
    renderWithProviders(<RequestsPage />);
    expect(
      screen.getByRole("button", { name: "requests.withdraw" }),
    ).toBeInTheDocument();
  });

  it("lets the requester dismiss their own denied request", () => {
    rows.list = [
      { ...base, status: "denied", requested_by: { id: "u", name: "Me" } },
    ];
    renderWithProviders(<RequestsPage />);
    expect(
      screen.getByRole("button", { name: "requests.dismiss" }),
    ).toBeInTheDocument();
  });

  it("offers a member nothing on someone else's request", () => {
    rows.list = [base];
    renderWithProviders(<RequestsPage />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("offers nothing on an approved request, even to an admin", () => {
    auth.isAdmin = true;
    rows.list = [{ ...base, status: "approved" }];
    renderWithProviders(<RequestsPage />);
    expect(
      screen.queryByRole("button", { name: "requests.delete" }),
    ).not.toBeInTheDocument();
  });

  it("deletes another user's denied request on the second click", () => {
    auth.isAdmin = true;
    const denied = { ...base, status: "denied" as const };
    rows.list = [denied];
    renderWithProviders(<RequestsPage />);
    fireEvent.click(screen.getByRole("button", { name: "requests.delete" }));
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("requests.confirmDelete"));
    expect(remove).toHaveBeenCalledWith(denied);
  });
});

describe("RequestsPage moderation", () => {
  beforeEach(() => {
    auth.isAdmin = true;
    approve.mockClear();
    deny.mockClear();
    refetch.mockClear();
    rows.failed = false;
    settings.show = 6;
  });

  it("preselects the default profile so Approve works untouched", () => {
    rows.list = [{ ...base, type: "show", tmdb_id: 7 }];
    renderWithProviders(<RequestsPage />);
    fireEvent.click(screen.getByText("requests.approve"));
    expect(approve).toHaveBeenCalledWith({ id: 1, quality_profile_id: 6 });
  });

  it("leaves Approve disabled when no default exists, instead of guessing", () => {
    settings.show = null;
    rows.list = [{ ...base, type: "show", tmdb_id: 7 }];
    renderWithProviders(<RequestsPage />);
    fireEvent.click(screen.getByText("requests.approve"));
    expect(approve).not.toHaveBeenCalled();
  });

  it("prefers the profile on the request itself", () => {
    rows.list = [{ ...base, type: "show", tmdb_id: 7, quality_profile_id: 5 }];
    renderWithProviders(<RequestsPage />);
    fireEvent.click(screen.getByText("requests.approve"));
    expect(approve).toHaveBeenCalledWith({ id: 1, quality_profile_id: 5 });
  });

  it("sends the typed reason when denying", () => {
    rows.list = [base];
    renderWithProviders(<RequestsPage />);
    fireEvent.click(screen.getByText("requests.deny"));
    fireEvent.change(screen.getByLabelText("requests.denyReasonLabel"), {
      target: { value: " Already owned " },
    });
    fireEvent.click(screen.getByText("requests.denyConfirm"));
    expect(deny).toHaveBeenCalledWith({ id: 1, deny_reason: "Already owned" });
  });

  it("denies without a reason when left blank", () => {
    rows.list = [base];
    renderWithProviders(<RequestsPage />);
    fireEvent.click(screen.getByText("requests.deny"));
    fireEvent.click(screen.getByText("requests.denyConfirm"));
    expect(deny).toHaveBeenCalledWith({ id: 1 });
  });

  it("shows the requester why a request was denied", () => {
    auth.isAdmin = false;
    rows.list = [{ ...base, status: "denied", deny_reason: "Out of scope" }];
    renderWithProviders(<RequestsPage />);
    expect(
      screen.getByText("requests.denyReason reason:Out of scope"),
    ).toBeInTheDocument();
  });

  it("shows a retry state, not the empty message, when loading fails", () => {
    rows.failed = true;
    renderWithProviders(<RequestsPage />);
    expect(screen.queryByText("requests.empty")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("common.retry"));
    expect(refetch).toHaveBeenCalled();
  });
});
