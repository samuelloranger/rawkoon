import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test-utils/render";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  useNavigate: () => navigate,
  useSearch: () => ({ redirect: undefined }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/auth/betterAuthClient", () => ({
  authClient: { signIn: { social: vi.fn() } },
}));

import { LoginForm } from "./LoginForm";

function fetcherWith(jellyfin: boolean) {
  return vi.fn(async (url: string) => {
    if (url === "/api/auth/sso-providers") {
      return { jellyfin_sign_in: jellyfin, providers: [] };
    }
    return { user: {} };
  });
}

describe("LoginForm Jellyfin option", () => {
  it("hides the Jellyfin button when sign-in is off", async () => {
    const fetcher = fetcherWith(false);
    renderWithProviders(<LoginForm />, { fetcher });
    await waitFor(() => expect(fetcher).toHaveBeenCalled());
    expect(screen.queryByText("login.jellyfin.signIn")).toBeNull();
  });

  it("opens the Jellyfin form, posts the credentials and navigates", async () => {
    const fetcher = fetcherWith(true);
    renderWithProviders(<LoginForm />, { fetcher });
    fireEvent.click(await screen.findByText("login.jellyfin.signIn"));

    fireEvent.change(screen.getByLabelText("login.jellyfin.username"), {
      target: { value: "alice" },
    });
    fireEvent.change(screen.getByLabelText("login.password"), {
      target: { value: "pw" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "login.jellyfin.continue" }),
    );

    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(fetcher).toHaveBeenCalledWith("/api/auth/sign-in/jellyfin", {
      method: "POST",
      body: { username: "alice", password: "pw" },
    });
  });

  it("returns to the email form on Back", async () => {
    renderWithProviders(<LoginForm />, { fetcher: fetcherWith(true) });
    fireEvent.click(await screen.findByText("login.jellyfin.signIn"));
    fireEvent.click(
      screen.getByRole("button", { name: "login.jellyfin.back" }),
    );
    expect(screen.getByLabelText("login.emailAddress")).toBeInTheDocument();
  });
});
