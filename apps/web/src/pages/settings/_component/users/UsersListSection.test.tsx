import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test-utils/render";

const noMutation = { mutateAsync: vi.fn(), isPending: false };
vi.mock("@/pages/settings/useAdminUsers", () => ({
  useAdminUsers: () => ({
    isLoading: false,
    error: null,
    data: {
      users: [
        {
          id: "u1",
          email: "abc123@jellyfin.invalid",
          first_name: null,
          last_name: null,
          is_admin: false,
          created_at: null,
          last_login: null,
          jellyfin_user_id: "abc123",
        },
        {
          id: "u2",
          email: "real@example.com",
          first_name: "Real",
          last_name: null,
          is_admin: false,
          created_at: null,
          last_login: null,
          jellyfin_user_id: null,
        },
      ],
    },
  }),
}));
vi.mock("@/pages/settings/useDeleteUser", () => ({
  useDeleteUser: () => noMutation,
}));
vi.mock("@/pages/settings/useUpdateUserRole", () => ({
  useUpdateUserRole: () => noMutation,
}));
vi.mock("@/pages/settings/useResetUserPassword", () => ({
  useResetUserPassword: () => noMutation,
}));
vi.mock("@/pages/settings/useJellyfinUserLink", () => ({
  useLinkJellyfinUser: () => noMutation,
  useImportJellyfinUsers: () => noMutation,
  useJellyfinUsers: () => ({
    error: null,
    data: {
      users: [
        { id: "abc123", name: "alice", disabled: false, linked_user_id: "u1" },
        { id: "j2", name: "bob", disabled: false, linked_user_id: null },
      ],
    },
  }),
}));
vi.mock("@/lib/auth/useAuth", () => ({
  useCurrentUser: () => ({ data: { id: "admin" } }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { UsersListSection } from "./UsersListSection";

describe("UsersListSection Jellyfin accounts", () => {
  it("shows a dash instead of the placeholder email", () => {
    renderWithProviders(<UsersListSection />);
    expect(screen.queryByText("abc123@jellyfin.invalid")).toBeNull();
    expect(screen.getByText("real@example.com")).toBeInTheDocument();
    // email column cell and the name fallback
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(1);
  });

  it("opens the import dialog from the header button", () => {
    renderWithProviders(<UsersListSection />);
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings.users.importJellyfin.button",
      }),
    );
    expect(screen.getByLabelText("bob")).toBeEnabled();
    expect(screen.getByLabelText("alice")).toBeDisabled();
  });
});
