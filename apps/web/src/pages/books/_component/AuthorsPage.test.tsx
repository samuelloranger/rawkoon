import { describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen } from "@/test-utils/render";

let isAdmin = false;
vi.mock("@/lib/auth/useAuth", () => ({
  useCurrentUser: () => ({ data: { is_admin: isAdmin } }),
  useAuth: () => ({ user: { is_admin: isAdmin } }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock("@/components/PageLayout", () => ({
  PageLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("../_hooks/useBooks", () => ({
  useAuthors: () => ({
    data: {
      authors: [
        {
          id: 1,
          name: "An Author",
          book_count: 2,
          monitored: true,
          monitor_from: null,
          last_checked_at: null,
          monitor_edition_kinds: ["ebook"],
          monitor_languages: [],
        },
      ],
    },
    isLoading: false,
    refetch: vi.fn(),
    isRefetching: false,
  }),
  useUpdateAuthor: () => ({
    isPending: false,
    isError: false,
    mutate: vi.fn(),
  }),
}));

import { AuthorsPage } from "./AuthorsPage";

describe("AuthorsPage", () => {
  it("makes monitoring read-only for a member, since the server refuses the change", () => {
    isAdmin = false;
    renderWithProviders(<AuthorsPage />);
    expect(screen.getByRole("switch")).toBeDisabled();
  });

  it("lets an admin change monitoring", () => {
    isAdmin = true;
    renderWithProviders(<AuthorsPage />);
    expect(screen.getByRole("switch")).toBeEnabled();
  });
});
