import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test-utils/render";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { JellyfinLinkSection } from "./JellyfinLinkSection";

function fetcherWith(
  signIn: boolean,
  profile: {
    linked: boolean;
    jellyfin_name: string | null;
    can_unlink: boolean;
  },
) {
  return vi.fn(async (url: string, init?: { method?: string }) => {
    if (url === "/api/auth/sso-providers") {
      return { jellyfin_sign_in: signIn, providers: [] };
    }
    if (url === "/api/profile/jellyfin" && !init?.method) return profile;
    return { success: true };
  });
}

describe("JellyfinLinkSection", () => {
  it("renders nothing when Jellyfin sign-in is off", async () => {
    const fetcher = fetcherWith(false, {
      linked: false,
      jellyfin_name: null,
      can_unlink: false,
    });
    const { container } = renderWithProviders(<JellyfinLinkSection />, {
      fetcher,
    });
    await waitFor(() => expect(fetcher).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("offers Link when not linked and opens the form", async () => {
    renderWithProviders(<JellyfinLinkSection />, {
      fetcher: fetcherWith(true, {
        linked: false,
        jellyfin_name: null,
        can_unlink: false,
      }),
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "settings.jellyfinLink.link" }),
    );
    expect(
      screen.getByLabelText("login.jellyfin.username"),
    ).toBeInTheDocument();
  });

  it("shows the linked name and unlinks", async () => {
    const fetcher = fetcherWith(true, {
      linked: true,
      jellyfin_name: "alice",
      can_unlink: true,
    });
    renderWithProviders(<JellyfinLinkSection />, { fetcher });
    expect(
      await screen.findByText("settings.jellyfinLink.linkedAs name:alice"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "settings.jellyfinLink.unlink" }),
    );
    await waitFor(() =>
      expect(fetcher).toHaveBeenCalledWith("/api/profile/jellyfin", {
        method: "DELETE",
      }),
    );
  });

  it("hides Unlink when the account has no other sign-in method", async () => {
    renderWithProviders(<JellyfinLinkSection />, {
      fetcher: fetcherWith(true, {
        linked: true,
        jellyfin_name: "alice",
        can_unlink: false,
      }),
    });
    await screen.findByText("settings.jellyfinLink.linkedAs name:alice");
    expect(
      screen.queryByRole("button", { name: "settings.jellyfinLink.unlink" }),
    ).toBeNull();
  });
});
